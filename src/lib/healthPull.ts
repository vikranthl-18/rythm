// ---------------------------------------------------------------------------
// rythm — real-device data pull (the web half of the native health bridge).
//
// The native tester build reads HealthKit / Health Connect and pushes per-day
// sample batches to the `health_samples` table (migration 0003). This module
// pulls those rows back, converts them into DailyMetrics days + UserDevice
// slots, and merges them into the store so a synced watch/ring shows up in
// the dashboard exactly like a sim device slot — no fabricated numbers.
//
// Rows are keyed (user_id, date, source, metric) where `source` is the native
// device slot id ("pixel-watch" / "apple-watch") and `samples` are
// { t: minutes-since-local-midnight, value } — the same MergeSample shape the
// priority engine consumes. RLS keeps the query scoped to the signed-in user.
// ---------------------------------------------------------------------------

import type { DailyMetrics, MetricKey, UserDevice } from "../types";
import { effectiveOrder } from "../engine/priority";
import { baselineBefore, computeRecovery } from "../engine/recovery";
import { computeSleepScore, nextSleepDebt, sleepNeedMin } from "../engine/sleep";
import { addDaysIso, todayIso } from "./rng";
import { supabase } from "./supabase";

/** Minimum number of days the dashboard window always spans. */
export const WINDOW_DAYS = 30;

/**
 * Hard cap on how far back a pull expands the window, even when the device
 * has years of history — charts and baselines only need the recent span, and
 * blank filler days stay bounded.
 */
export const MAX_WINDOW_DAYS = 90;

export interface HealthSampleRow {
  date: string; // YYYY-MM-DD (local to the phone)
  source: string; // device slot id, e.g. "pixel-watch" / "apple-watch"
  metric: string; // MetricKey
  samples: { t: number; value: number }[];
}

const ALL_METRICS: MetricKey[] = [
  "hr",
  "sleep",
  "restingHR",
  "hrv",
  "steps",
  "activeEnergy",
  "calories",
  "zoneMinutes",
  "skinTemp",
  "spo2",
  "respRate",
];

/** The last WINDOW_DAYS dates (oldest → newest), in the app's YYYY-MM-DD keys. */
export function healthWindowDates(): string[] {
  return windowForRows([]);
}

/**
 * The dashboard window (oldest → newest, inclusive of today). Always at least
 * WINDOW_DAYS back; extends to the earliest row's date when a device has more
 * history — capped at MAX_WINDOW_DAYS so a full-history pull shows up without
 * the window growing unbounded.
 */
export function windowForRows(rows: HealthSampleRow[], today = todayIso()): string[] {
  let earliest: string | null = null;
  for (const r of rows) {
    if (earliest === null || r.date < earliest) earliest = r.date;
  }
  const minStart = addDaysIso(today, -(MAX_WINDOW_DAYS - 1));
  const from =
    earliest === null
      ? addDaysIso(today, -(WINDOW_DAYS - 1))
      : earliest < minStart
        ? minStart
        : earliest;
  const out: string[] = [];
  let d = from;
  while (d <= today) {
    out.push(d);
    d = addDaysIso(d, 1);
  }
  return out;
}

const avg = (a: number[]) =>
  a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/**
 * Decode the sleep metric's stage-encoded samples. The native bridge pushes a
 * cluster of 5 consecutive samples per sleep session: [total, deep, rem,
 * light, awake] — where `total` is time ASLEEP (deep+light+REM, awake
 * excluded, matching the watch). Sessions in the same day are spaced apart
 * (seq * 10000) so clusters never merge. Clusters are grouped by contiguous
 * timestamps; anything that isn't a full 5-sample cluster still contributes
 * its total.
 */
export function decodeSleepSamples(
  samples: { t: number; value: number }[]
): { durationMin: number; deepMin: number; lightMin: number; remMin: number; awakeMin: number } {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const clusters: { t: number; value: number }[][] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && last[last.length - 1].t === s.t - 1) last.push(s);
    else clusters.push([s]);
  }
  let total = 0,
    deep = 0,
    light = 0,
    rem = 0,
    awake = 0;
  for (const c of clusters) {
    if (c.length >= 5) {
      total += c[0].value;
      deep += c[1].value;
      rem += c[2].value;
      light += c[3].value;
      awake += c[4].value;
    } else if (c.length === 1) {
      total += c[0].value;
    }
  }
  return { durationMin: total, deepMin: deep, lightMin: light, remMin: rem, awakeMin: awake };
}

/** The samples ONE source pushed for a (date, metric). */
function valuesForSource(
  rows: HealthSampleRow[],
  date: string,
  metric: string,
  source: string
): { t: number; value: number }[] {
  // A merged device (e.g. the Pixel Watch's three Google origins) is resolved
  // by preference order — the FIRST origin with a reading wins. This keeps
  // "one measurement per device" semantics: merging slots must never sum the
  // same steps twice.
  for (const key of sourceKeysFor(source)) {
    for (const r of rows) {
      if (r.date === date && r.metric === metric && sourceMatches(r.source, key)) return r.samples;
    }
  }
  return [];
}

/**
 * Legacy source key from pre-per-origin builds: everything was lumped under
 * one slot. Kept as a FALLBACK only — it counts when no per-device row exists
 * for a (date, metric), so an old build's data still shows until the user
 * re-reads, but it can never double-count beside per-device rows.
 */
const LEGACY_SOURCE = "pixel-watch";

/**
 * Rows pushed by the pre-origin build's sleep path (no data origin attached).
 * Re-reads label sleep with the real origin (hc:<package>) under a DIFFERENT
 * source key, so these orphaned rows can never be overwritten — skip them for
 * device creation to avoid a phantom "Unknown" slot. Their data is superseded
 * by the correctly-labelled rows.
 */
const UNKNOWN_SOURCE = "hc:unknown";

/**
 * Resolve the winning source for a (date, metric): the first device in the
 * per-metric priority order that actually recorded that metric that day. This
 * is Rule 1 + Rule 3 of the priority engine applied to daily rows — the watch
 * and the ring measure the SAME steps/sleep, so only ONE device's numbers may
 * count, and if the top device has no reading (charging/dead), the next in
 * order fills in. When no per-device row exists, the legacy combined row is
 * the last resort (old builds).
 */
function winningSamples(
  rows: HealthSampleRow[],
  date: string,
  metric: MetricKey,
  order: string[]
): { t: number; value: number }[] {
  for (const src of order) {
    const v = valuesForSource(rows, date, metric, src);
    if (v.length) return v;
  }
  return valuesForSource(rows, date, metric, LEGACY_SOURCE);
}

/** Metrics whose samples are raw intraday readings (NOT sleep's stage clusters). */
const INTRADAY_METRICS: MetricKey[] = [
  "hr",
  "restingHR",
  "hrv",
  "steps",
  "activeEnergy",
  "calories",
  "zoneMinutes",
  "skinTemp",
  "spo2",
  "respRate",
];

/**
 * Build one DailyMetrics day from a date's rows (preserving engine outputs).
 * Every metric resolves to ONE device's samples via the priority order — the
 * watch and ring measure the same physical steps/sleep, so they must never be
 * summed. Raw intraday samples ride along on the day so the detail views can
 * draw a same-day "up and down" chart instead of only a multi-day trend.
 */
function dayFromRows(
  date: string,
  rows: HealthSampleRow[],
  base: DailyMetrics | null,
  order: (metric: MetricKey) => string[]
): DailyMetrics {
  const sl = decodeSleepSamples(winningSamples(rows, date, "sleep", order("sleep")));
  const intraday: DailyMetrics["intraday"] = {};
  for (const m of INTRADAY_METRICS) {
    const v = winningSamples(rows, date, m, order(m));
    if (v.length) intraday[m] = v;
  }
  return {
    date,
    measuredAtMin: base?.measuredAtMin ?? 360,
    hrv: avg(winningSamples(rows, date, "hrv", order("hrv")).map((s) => s.value)),
    restingHR: avg(winningSamples(rows, date, "restingHR", order("restingHR")).map((s) => s.value)),
    skinTemp: avg(winningSamples(rows, date, "skinTemp", order("skinTemp")).map((s) => s.value)),
    spo2: avg(winningSamples(rows, date, "spo2", order("spo2")).map((s) => s.value)),
    respRate: avg(winningSamples(rows, date, "respRate", order("respRate")).map((s) => s.value)),
    steps: sum(winningSamples(rows, date, "steps", order("steps")).map((s) => s.value)),
    activeEnergy: sum(winningSamples(rows, date, "activeEnergy", order("activeEnergy")).map((s) => s.value)),
    calories: sum(winningSamples(rows, date, "calories", order("calories")).map((s) => s.value)),
    activeZoneMin: sum(winningSamples(rows, date, "zoneMinutes", order("zoneMinutes")).map((s) => s.value)),
    sleep: {
      date,
      durationMin: sl.durationMin,
      deepMin: sl.deepMin,
      lightMin: sl.lightMin,
      remMin: sl.remMin,
      awakeMin: sl.awakeMin,
      needMin: base?.sleep.needMin ?? 0,
      score: 0, // recomputed by the sleep engine from the stage breakdown
    },
    recovery: base?.recovery ?? 0,
    strain: base?.strain ?? 0,
    intraday,
  };
}

/** Blank day (same shape as freshAccountData's) for window dates with no data. */
export function blankDay(date: string): DailyMetrics {
  return {
    date,
    measuredAtMin: 360,
    hrv: 0,
    restingHR: 0,
    skinTemp: 0,
    spo2: 0,
    respRate: 0,
    steps: 0,
    activeEnergy: 0,
    calories: 0,
    activeZoneMin: 0,
    sleep: {
      date,
      durationMin: 0,
      deepMin: 0,
      lightMin: 0,
      remMin: 0,
      awakeMin: 0,
      needMin: 0,
      score: 0,
    },
    recovery: 0,
    strain: 0,
    intraday: {},
  };
}

/**
 * Recompute the engine-derived scores (sleep need, sleep score, recovery) for
 * pulled days. The pull itself only fills raw vitals; the Whoop-style scores
 * are outputs of the engines and must be (re)computed from the merged days —
 * otherwise a real user's recovery / sleep score silently read as 0. Mirrors
 * the per-day computation the demo seed does (src/data/seed.ts). Days with no
 * real vitals or sleep stay 0 (honest "no data").
 */
export function recomputeDayScores(days: DailyMetrics[]): DailyMetrics[] {
  let prevStrain = 0;
  let debtMin = 0;
  return days.map((d) => {
    const needMin = sleepNeedMin(prevStrain, debtMin);
    const hasSleep = d.sleep.durationMin > 0;
    const hasVitals = d.hrv > 0 || d.restingHR > 0 || d.skinTemp > 0;
    const score = hasSleep
      ? computeSleepScore({
          durationMin: d.sleep.durationMin,
          deepMin: d.sleep.deepMin,
          remMin: d.sleep.remMin,
          awakeMin: d.sleep.awakeMin,
          needMin,
        })
      : 0;
    const bHrv = baselineBefore(days, d.date, (x) => x.hrv);
    const bRhr = baselineBefore(days, d.date, (x) => x.restingHR);
    const bTemp = baselineBefore(days, d.date, (x) => x.skinTemp);
    const recovery =
      hasVitals || hasSleep
        ? computeRecovery({
            hrv: d.hrv,
            baselineHrv: bHrv.baseline,
            sdHrv: bHrv.sd,
            rhr: d.restingHR,
            baselineRhr: bRhr.baseline,
            sdRhr: bRhr.sd,
            sleepScore: score,
            skinTemp: d.skinTemp,
            baselineTemp: bTemp.baseline,
            sdTemp: bTemp.sd,
          })
        : 0;
    debtMin = nextSleepDebt(needMin, d.sleep.durationMin, debtMin);
    prevStrain = d.strain;
    return { ...d, sleep: { ...d.sleep, needMin, score }, recovery };
  });
}

/**
 * Health Connect's own phone storage id is per-phone and includes a random
 * suffix (com.android.healthconnect.phone.<hash>), so it can only be matched
 * by prefix. It's the phone itself — Google Play Services writes steps and
 * active energy through it, and other apps relay through it.
 */
const PHONE_HC_PREFIX = "com.android.healthconnect.phone";

/** Known Health Connect data origins → friendly device names. */
const ORIGIN_NAMES: Record<string, string> = {
  "com.google.android.apps.fitness": "Pixel Watch",
  "com.google.android.wearable.healthservices": "Pixel Watch",
  "com.google.android.apps.wearables.maestro": "Pixel Watch",
  "com.fitbit.FitbitMobile": "Pixel Watch", // the Pixel Watch's Fitbit app
  "com.google.android.gms": "Phone",
  "com.zing.qring": "Smart Ring",
  "com.zing.smartring": "Smart Ring",
  "com.colmi.smartring": "Smart Ring",
  "com.app.cq.ring": "Smart Ring",
};

/**
 * Origins that are the SAME physical device. Key = the canonical slot id
 * (the preferred origin, listed first); value = every origin that physical
 * device writes through. A Pixel Watch writes to Health Connect via several
 * Google packages (the Fit app, the watch's own health services, Google Fit)
 * and a ring's companion app can ship several package names (qring / smartring /
 * colmi) — without this the Devices tab shows the same device multiple times.
 * Within a group only ONE origin's numbers count per (date, metric), so merging
 * never double-counts the same steps.
 *
 * Any remaining origins that share a curated friendly name (ORIGIN_NAMES) are
 * grouped automatically (first-listed package becomes the canonical id) — a
 * safety net for ring/watch apps that ship packages we haven't enumerated.
 * Only curated names participate; the derived fallback name is never used for
 * merging, so unrelated apps can't collapse by coincidence.
 */
const DEVICE_GROUPS: Record<string, string[]> = (() => {
  const groups: Record<string, string[]> = {
    "com.google.android.apps.fitness": [
      "com.google.android.apps.fitness",
      "com.google.android.wearable.healthservices",
      "com.google.android.apps.wearables.maestro",
      "com.fitbit.FitbitMobile", // the watch writes via its Fitbit app too
    ],
    // The ring's real package (com.app.cq.ring, seen in the wild) is the
    // canonical slot; companion-app variants fold in under it.
    "com.app.cq.ring": ["com.app.cq.ring", "com.zing.qring", "com.zing.smartring", "com.colmi.smartring"],
    // The phone: its per-device Health Connect storage id (matched by prefix
    // in canonicalId) plus Google Play Services, which also counts steps.
    "com.android.healthconnect.phone": ["com.android.healthconnect.phone", "com.google.android.gms"],
  };
  const byName = new Map<string, string[]>();
  for (const origin of Object.keys(ORIGIN_NAMES)) {
    const name = ORIGIN_NAMES[origin];
    const list = byName.get(name);
    if (list) list.push(origin);
    else byName.set(name, [origin]);
  }
  for (const members of byName.values()) {
    if (members.length > 1 && !members.some((m) => groups[m])) {
      groups[members[0]] = members;
    }
  }
  return groups;
})();

/** The canonical device slot id for a source (grouped origins share one). */
const canonicalId = (source: string): string => {
  if (!source.startsWith("hc:")) return source;
  const origin = source.slice(3);
  if (origin.startsWith(PHONE_HC_PREFIX)) return `hc:${PHONE_HC_PREFIX}`;
  for (const [canon, members] of Object.entries(DEVICE_GROUPS)) {
    if (members.includes(origin)) return `hc:${canon}`;
  }
  return source;
};

/**
 * The hc: source keys a canonical device id represents (its whole group),
 * in preference order — the first member with a reading wins, so a merged
 * slot still means "one measurement", never a sum of the same steps.
 */
function sourceKeysFor(source: string): string[] {
  if (source.startsWith("hc:")) {
    const origin = source.slice(3);
    return (DEVICE_GROUPS[origin] ?? [origin]).map((o) => `hc:${o}`);
  }
  return [source];
}

/**
 * Whether a stored row's source key satisfies a group key. Exact match, or a
 * prefix match so the canonical phone id (hc:com.android.healthconnect.phone)
 * resolves rows stored under per-phone hashed ids
 * (hc:com.android.healthconnect.phone.<hash>).
 */
function sourceMatches(rowSource: string, key: string): boolean {
  if (rowSource === key) return true;
  return key.startsWith("hc:") && rowSource.startsWith(key + ".");
}

/** Watch-ish origins rank first so the watch wins ties by default. */
const WATCH_ORIGINS = new Set([
  "com.google.android.apps.fitness",
  "com.google.android.wearable.healthservices",
  "com.google.android.apps.wearables.maestro",
  "com.fitbit.FitbitMobile",
]);

/** Derive a display name from an unknown origin package (e.g. the ring app). */
function friendlyOrigin(origin: string): string {
  if (ORIGIN_NAMES[origin]) return ORIGIN_NAMES[origin];
  if (origin.startsWith(PHONE_HC_PREFIX)) return "Phone";
  const last = origin.split(".").filter(Boolean).pop() ?? origin;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Human name for a cloud source key ("hc:com.app.cq.ring" → "Smart Ring"). */
export function friendlySourceName(source: string): string {
  if (source.includes("apple")) return "Apple Watch";
  if (source.startsWith("hc:")) return friendlyOrigin(source.slice(3));
  return "Health Connect device";
}

/** App-level labels for known origins — the short "what app wrote this" line. */
const ORIGIN_APP_LABELS: Record<string, string> = {
  "com.google.android.apps.fitness": "Google Fit",
  "com.google.android.wearable.healthservices": "Watch services",
  "com.google.android.apps.wearables.maestro": "Watch services",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.google.android.gms": "Play Services",
  "com.zing.qring": "qring",
  "com.zing.smartring": "qring",
  "com.colmi.smartring": "qring",
  "com.app.cq.ring": "qring",
};

/**
 * Short, human label for a raw source key — "what app wrote this" — instead
 * of the long hc:<package> id (e.g. "hc:com.fitbit.FitbitMobile" → "Fitbit").
 */
export function shortOriginLabel(source: string): string {
  const origin = source.startsWith("hc:") ? source.slice(3) : source;
  if (origin.startsWith(PHONE_HC_PREFIX)) return "Health Connect";
  if (ORIGIN_APP_LABELS[origin]) return ORIGIN_APP_LABELS[origin];
  const last = origin.split(".").filter(Boolean).pop() ?? origin;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

// ---------------------------------------------------------------------------
// Device truth report — "who's right: ring or watch?"
//
// The app is the only one that merges multiple wearables, so it's in a
// unique position to tell the user WHEN its devices disagree and WHICH one
// to trust. Computed from the raw rows: per metric, per device, the average
// reading + how many days it covered, the agreement rate on shared days, and
// a plain-language recommendation.
// ---------------------------------------------------------------------------

export interface DeviceTruthDevice {
  id: string;
  name: string;
  value: number;
  days: number;
}

export interface DeviceTruthMetric {
  metric: MetricKey;
  label: string;
  icon: string;
  unit: string;
  perDevice: DeviceTruthDevice[];
  /** % of shared days where the top two devices were within 10% of each other */
  agreePct: number | null;
  recommendedId: string | null;
  note: string;
}

const TRUTH_META: Record<string, { label: string; icon: string; unit: string }> = {
  steps: { label: "Steps", icon: "👟", unit: "" },
  sleep: { label: "Sleep", icon: "🛌", unit: "min" },
  hrv: { label: "HRV", icon: "🧠", unit: "ms" },
  restingHR: { label: "Resting HR", icon: "🫀", unit: "bpm" },
  calories: { label: "Calories", icon: "🔥", unit: "kcal" },
  skinTemp: { label: "Skin temp", icon: "🌡️", unit: "°C" },
  spo2: { label: "SpO₂", icon: "🫁", unit: "%" },
  respRate: { label: "Resp rate", icon: "🌬️", unit: "/min" },
};

/** Counter metrics aggregate by SUM per day; vitals by AVERAGE. */
const TRUTH_COUNTERS = new Set(["steps", "calories", "activeEnergy", "zoneMinutes"]);

function metricDailyValue(metric: string, samples: { t: number; value: number }[]): number | null {
  if (metric === "sleep") {
    const dur = decodeSleepSamples(samples).durationMin;
    return dur > 0 ? dur : null;
  }
  if (!samples.length) return null;
  if (TRUTH_COUNTERS.has(metric)) return samples.reduce((a, s) => a + s.value, 0);
  return samples.reduce((a, s) => a + s.value, 0) / samples.length;
}

/**
 * Compare every metric two+ devices actually measured (≥3 days each) and
 * recommend which one to trust. Pure function over the raw cloud rows.
 */
export function computeDeviceTruth(rows: HealthSampleRow[]): DeviceTruthMetric[] {
  // metric → canonical device id → date → daily value
  const byMetric = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    if (r.source === LEGACY_SOURCE || r.source === UNKNOWN_SOURCE) continue;
    const v = metricDailyValue(r.metric, r.samples);
    if (v === null || v === 0) continue;
    const id = canonicalId(r.source);
    if (!byMetric.has(r.metric)) byMetric.set(r.metric, new Map());
    const m = byMetric.get(r.metric)!;
    if (!m.has(id)) m.set(id, new Map());
    m.get(id)!.set(r.date, v);
  }

  const out: DeviceTruthMetric[] = [];
  for (const [metric, devices] of byMetric) {
    const meta = TRUTH_META[metric];
    if (!meta) continue;
    const ranked = [...devices.entries()]
      .map(([id, byDate]) => ({ id, byDate }))
      .filter((e) => e.byDate.size >= 3)
      .sort((a, b) => b.byDate.size - a.byDate.size);
    if (ranked.length < 2) continue; // truth needs two real devices
    const [first, second] = ranked;
    const shared = [...first.byDate.keys()].filter((d) => second.byDate.has(d));
    let agree = 0;
    for (const d of shared) {
      const a = first.byDate.get(d)!;
      const b = second.byDate.get(d)!;
      if (Math.abs(a - b) / Math.max(1, Math.min(a, b)) <= 0.1) agree++;
    }
    const agreePct = shared.length ? Math.round((agree / shared.length) * 100) : null;
    const perDevice = ranked.map((e) => {
      const values = [...e.byDate.values()];
      return {
        id: e.id,
        name: friendlyOrigin(e.id.startsWith("hc:") ? e.id.slice(3) : e.id),
        value: values.reduce((a, b) => a + b, 0) / values.length,
        days: e.byDate.size,
      };
    });
    const top = perDevice[0];
    const secondDev = perDevice[1];
    const diffPct = (Math.abs(top.value - secondDev.value) / Math.max(1, Math.min(top.value, secondDev.value))) * 100;
    const note =
      shared.length < 3
        ? `${top.name} has the most ${meta.label.toLowerCase()} readings (${top.days} days) — trust it until both devices have covered a week together.`
        : diffPct <= 10
          ? `${top.name} and ${secondDev.name} agree closely on ${meta.label.toLowerCase()} (${agreePct}% of shared days within 10%) — either is reliable for you.`
          : `${top.name} and ${secondDev.name} disagree by ~${Math.round(diffPct)}% on ${meta.label.toLowerCase()}. ${top.name} is more consistent for you — prefer it when the numbers matter.`;
    out.push({
      metric: metric as MetricKey,
      label: meta.label,
      icon: meta.icon,
      unit: meta.unit,
      perDevice,
      agreePct,
      recommendedId: first.id,
      note,
    });
  }
  return out.sort((a, b) => (a.agreePct ?? 101) - (b.agreePct ?? 101));
}

/**
 * Aggregate raw per-source batch counts up to canonical device slots — the
 * display set on the Devices tab — so a merged slot shows the TOTAL batches
 * across every origin that writes for it (e.g. Pixel Watch = Fit app + watch
 * health services + Fitbit app; Phone = per-phone Health Connect storage +
 * Google Play Services). Legacy flat rows (pixel-watch, hc:unknown) map to no
 * slot and come back separately as orphans.
 */
export function canonicalSourceCounts(sourceCounts: Record<string, number>): {
  counts: Record<string, number>;
  orphans: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const orphans: Record<string, number> = {};
  for (const [src, n] of Object.entries(sourceCounts)) {
    if (src === LEGACY_SOURCE || src === UNKNOWN_SOURCE) {
      orphans[src] = n;
      continue;
    }
    const id = canonicalId(src);
    counts[id] = (counts[id] ?? 0) + n;
  }
  return { counts, orphans };
}

function deviceFor(source: string, rank: number, metrics: string[]): UserDevice {
  const isApple = source.includes("apple");
  const isHc = source.startsWith("hc:");
  const origin = isHc ? source.slice(3) : "";
  const present = metrics.filter((m): m is MetricKey => (ALL_METRICS as string[]).includes(m));
  return {
    id: source,
    name: isApple ? "Apple Watch" : isHc ? friendlyOrigin(origin) : "Health Connect device",
    model: source,
    source: isApple ? "HEALTHKIT" : "HEALTH_CONNECT",
    priorityRank: rank,
    battery: 100,
    connected: true,
    lastSyncMin: 2,
    color: isApple ? "#f472b6" : isHc && WATCH_ORIGINS.has(origin) ? "#60a5fa" : "#a78bfa",
    specialty: present.length ? present : ["hrv"],
    metricOrder: Object.fromEntries(ALL_METRICS.map((m) => [m, [source]])) as UserDevice["metricOrder"],
  };
}

export interface HealthPull {
  days: DailyMetrics[];
  devices: UserDevice[];
  /** raw (date, source, metric) batch counts per cloud source — diagnostics */
  sourceCounts: Record<string, number>;
  /** "who's right" comparisons when two+ devices measured the same metric */
  truth: DeviceTruthMetric[];
}

export interface HealthPullResult {
  ok: boolean;
  reason?: "no-supabase" | "no-session" | "empty" | "error";
  error?: string;
  days?: DailyMetrics[];
  devices?: UserDevice[];
  sourceCounts?: Record<string, number>;
  truth?: DeviceTruthMetric[];
}

/**
 * Pure conversion: health_samples rows → a window of DailyMetrics + one
 * UserDevice per real device (the watch, the ring, the phone — each its own
 * slot, matching the Devices tab). Same-physical-device origins (a Pixel
 * Watch writes via several Google packages) collapse into one slot; within a
 * merged slot only ONE origin's numbers count, so nothing double-counts.
 * Dates without data become blank days (so the window is contiguous for the
 * baseline engines); existing days are preserved as the base for dates the
 * pull can't fill.
 *
 * Legacy rows pushed by pre-per-origin builds used the flat source
 * "pixel-watch" with everything combined. They're not shown as a device and
 * only count as a last-resort fallback per (date, metric) — so data from an
 * old build still displays until the user re-reads, but never inflates the
 * numbers once per-device rows arrive.
 */
export function healthRowsToDays(
  rows: HealthSampleRow[],
  windowDates: string[],
  baseDays: DailyMetrics[] = [],
  baseDevices: UserDevice[] = []
): HealthPull {
  const baseByDate = new Map(baseDays.map((d) => [d.date, d]));
  // Raw per-source batch counts — the ground truth for the Devices tab's
  // "Cloud data sources" panel (every package that ever wrote a row, even
  // legacy/unknown ones, so orphaned data is visible instead of mysterious).
  const sourceCounts: Record<string, number> = {};
  for (const r of rows) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
  const sources = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.source === LEGACY_SOURCE || r.source === UNKNOWN_SOURCE) continue; // never its own device
    // Same-physical-device origins (e.g. the Pixel Watch's three Google
    // packages, or a ring app's several packages) collapse into one
    // canonical slot id.
    const id = canonicalId(r.source);
    if (!sources.has(id)) sources.set(id, new Set());
    sources.get(id)!.add(r.metric);
  }
  // Deterministic first-seen order, watch-ish origins first (ties broken by
  // first appearance). The user's Devices-tab reorder overrides this below.
  const knownFirst = [...sources.keys()].sort((a, b) => {
    const aw = WATCH_ORIGINS.has(a.slice(3)) ? 0 : 1;
    const bw = WATCH_ORIGINS.has(b.slice(3)) ? 0 : 1;
    return aw - bw;
  });
  const devices = knownFirst.map((src, i) => deviceFor(src, i + 1, [...(sources.get(src) ?? [])]));
  // Per-metric order: honor the user's device reorder from the Devices tab
  // (base devices' metricOrder), then append any newly-pulled source. Order
  // entries are canonical device ids — resolution expands each to its origin
  // group internally.
  const orderFor = (metric: MetricKey): string[] => {
    const order = baseDevices.length ? effectiveOrder(metric, baseDevices) : [];
    const have = new Set(order);
    for (const src of knownFirst) if (!have.has(src)) {
      order.push(src);
      have.add(src);
    }
    return order;
  };
  // Stamp every device with the FULL effective per-metric order. deviceFor
  // defaults each device's metricOrder to just itself, which makes the
  // Devices tab's "tap to rotate" a silent no-op on cloud devices (the
  // rotation guard requires >= 2 entries) and drops any saved reorder on the
  // next pull. Giving every device the same full order — which already
  // honors the user's saved reorder from baseDevices — makes rotation work
  // AND keeps it stable across the 60s pull loop.
  for (const d of devices) {
    d.metricOrder = Object.fromEntries(
      ALL_METRICS.map((m) => [m, orderFor(m)])
    ) as UserDevice["metricOrder"];
  }
  const days = windowDates.map((date) => {
    const hasData = rows.some((r) => r.date === date);
    if (!hasData) return baseByDate.get(date) ?? blankDay(date);
    return dayFromRows(date, rows, baseByDate.get(date) ?? null, orderFor);
  });
  return { days, devices, sourceCounts, truth: computeDeviceTruth(rows) };
}

/**
 * Fetch the signed-in user's health_samples for the window and convert them.
 * Returns an explicit result so the caller can show WHY nothing synced
 * (no session, empty table, or a real query error like migration 0003 not
 * being run yet) instead of silently doing nothing. `baseDevices` carries the
 * user's Devices-tab reordering into the per-metric resolution.
 */
export async function pullHealthRows(
  baseDays: DailyMetrics[] = [],
  baseDevices: UserDevice[] = []
): Promise<HealthPullResult> {
  if (!supabase) return { ok: false, reason: "no-supabase" };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "no-session" };
  try {
    // Pull everything for this user — the window is derived from the earliest
    // row, so a device with weeks of history shows all of it, not just today.
    const { data, error } = await supabase
      .from("health_samples")
      .select("date, source, metric, samples")
      .order("date");
    if (error) return { ok: false, reason: "error", error: error.message };
    if (!data || data.length === 0) return { ok: false, reason: "empty" };
    const rows = data as unknown as HealthSampleRow[];
    const { days, devices, sourceCounts, truth } = healthRowsToDays(rows, windowForRows(rows), baseDays, baseDevices);
    return { ok: true, days, devices, sourceCounts, truth };
  } catch (e) {
    return { ok: false, reason: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
