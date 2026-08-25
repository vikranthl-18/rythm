// ---------------------------------------------------------------------------
// Android Health Connect reader (react-native-health-connect v4).
//
// Health Connect is how Pixel Watches / Wear OS / Garmin (Android) sync data.
// It's an OS-level data vault the user grants apps access to. The reader below
// mirrors the metric families the web app's sim produces so the merge engine
// treats an Android watch exactly like any other device slot.
//
// Permissions: the app must be added to Health Connect's allowlist before
// testers can grant access (Play Console → Health apps declaration; ~7 days +
// whitelist propagation). See native/README.md.
// ---------------------------------------------------------------------------

import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  requestPermission,
  readRecords,
  SdkAvailabilityStatus,
  SleepStageType,
  type Permission,
} from "react-native-health-connect";
import type { NativeRecord, NativeSource } from "./types";

export const healthConnectSource: NativeSource = {
  deviceId: "pixel-watch",
  deviceName: "Pixel Watch",
  kind: "healthconnect",
};

/** Whether Health Connect is installed and the SDK is usable. */
export async function healthConnectStatus(): Promise<"available" | "not-installed" | "unknown"> {
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE) return "not-installed";
    return "unknown"; // provider update required — still usable after update
  } catch {
    return "unknown";
  }
}

const READ_PERMS: Permission[] = [
  { accessType: "read", recordType: "HeartRate" },
  { accessType: "read", recordType: "RestingHeartRate" },
  { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "TotalCaloriesBurned" },
  { accessType: "read", recordType: "ActiveCaloriesBurned" },
  { accessType: "read", recordType: "SleepSession" },
  { accessType: "read", recordType: "OxygenSaturation" },
  { accessType: "read", recordType: "BodyTemperature" },
  { accessType: "read", recordType: "ExerciseSession" },
];

export type HealthConnectPermResult =
  | { ok: true }
  | { ok: false; reason: "not-installed" | "allowlist" | "declined" | "error"; message: string };

/**
 * Request the minimum read set. Distinguishes the three failure modes that
 * actually matter to testers:
 *   - not-installed → Health Connect app is missing
 *   - allowlist     → the app isn't approved yet (PERMISSION_ERROR) — a
 *                     Google-side gate, not a user mistake
 *   - declined      → the user tapped "don't allow"
 */
export async function requestHealthConnectPermissions(): Promise<HealthConnectPermResult> {
  try {
    await initialize();
  } catch {
    return {
      ok: false,
      reason: "not-installed",
      message: "Health Connect isn't available on this device. Install it from the Play Store, then retry.",
    };
  }
  try {
    const granted = await requestPermission(READ_PERMS);
    if (granted.length === 0) {
      return {
        ok: false,
        reason: "declined",
        message: "Health Connect access was declined. Open the Health Connect app → Permissions → rythm and allow access, then retry.",
      };
    }
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_ERROR" || /not allowed|not allowlisted|permission denied/i.test(err?.message ?? "")) {
      return {
        ok: false,
        reason: "allowlist",
        message: "Health Connect blocked this app (not allowlisted yet). The rythm developer needs to finish the Health Connect declaration in Play Console before permissions can be granted.",
      };
    }
    return { ok: false, reason: "error", message: err?.message ?? "Something went wrong requesting Health Connect access." };
  }
}

/**
 * Whether the user has already granted at least one read permission. Used by
 * the AUTO-SYNC path: we never pop the permission dialog ourselves — if the
 * user hasn't connected yet, auto-sync waits quietly and the Health tab's
 * "Read" button (which does prompt) stays the onboarding step.
 *
 * The client MUST be initialized first: getGrantedPermissions rejects with
 * ClientNotInitialized otherwise (the native module checks the bound client
 * before every call except getSdkStatus). Without this, auto-sync reported
 * "not connected" forever even after the user granted access on the Health
 * tab — initialize() is cheap and idempotent (getOrCreate), so it's safe to
 * call on every check.
 */
export async function healthConnectPermitted(): Promise<boolean> {
  try {
    await initialize();
  } catch {
    return false;
  }
  try {
    const granted = await getGrantedPermissions();
    return granted.some((p) => p.accessType === "read");
  } catch {
    return false;
  }
}

const DAY_MS = 86_400_000;

/**
 * Local calendar-day boundaries (start → next start) for the last `days`
 * days, oldest first, as UTC instants for Health Connect queries. Day
 * arithmetic is done on LOCAL dates (setDate) so DST shifts can't skew the
 * buckets; the label is the local YYYY-MM-DD the web app keys days by.
 */
function localDayRanges(
  days: number,
  end: Date = new Date()
): { start: string; end: string; label: string }[] {
  const out: { start: string; end: string; label: string }[] = [];
  const todayMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = days - 1; i >= 0; i--) {
    const s = new Date(todayMidnight);
    s.setDate(s.getDate() - i);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    out.push({
      start: s.toISOString(),
      end: e.toISOString(),
      label: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`,
    });
  }
  return out;
}

interface StepInterval {
  startTime: string;
  endTime: string;
  count: number;
}

/**
 * Bucket interval step records into per-HOUR counts within one calendar day
 * (dayStartMs → dayEndMs, both UTC instants of the local day). Records are
 * clamped to the day, and a record straddling midnight splits proportionally
 * across the hours it covers — so the same record contributes to both days
 * in the right amounts. Returns { t: minutes-since-local-midnight, value }.
 */
function hourlyBuckets(
  records: StepInterval[],
  dayStartMs: number,
  dayEndMs: number
): { t: number; value: number }[] {
  const buckets = new Map<number, number>();
  for (const r of records) {
    const recStart = new Date(r.startTime).getTime();
    const recEnd = new Date(r.endTime).getTime();
    const span = recEnd - recStart;
    if (span <= 0) continue;
    const s = Math.max(recStart, dayStartMs);
    const e = Math.min(recEnd, dayEndMs);
    if (e <= s) continue; // record doesn't touch this day
    let cur = s;
    while (cur < e) {
      const hour = Math.floor((cur - dayStartMs) / 3_600_000);
      const boundary = Math.min(e, dayStartMs + (hour + 1) * 3_600_000);
      buckets.set(hour, (buckets.get(hour) ?? 0) + (r.count * (boundary - cur)) / span);
      cur = boundary;
    }
  }
  return [...buckets.entries()]
    .filter(([, v]) => v > 0)
    .map(([h, v]) => ({ t: h * 60, value: Math.round(v) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * High-frequency metrics (heart rate, SpO2) are sampled continuously, so even
 * a "full history" read keeps them capped at this many days — the payload stays
 * light while daily/aggregate metrics (sleep, steps, HRV, resting HR, calories,
 * temperature…) use the full requested range.
 */
const CONTINUOUS_CAP_DAYS = 7;

/** Pull every supported record over the last `days` (default: 1). */
export async function readHealthConnect(days = 1): Promise<NativeRecord[]> {
  // Bind the client before any read. The auto-sync path calls this directly
  // (it does NOT go through requestHealthConnectPermissions, which is the
  // only other place initialize() is called) — without this every readRecords
  // call rejects with ClientNotInitialized and auto-sync silently fails.
  try {
    await initialize();
  } catch {
    // If binding fails the reads below throw; the caller's try/catch turns
    // it into a readable error instead of a silent empty read.
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);
  const cap = Math.min(days, CONTINUOUS_CAP_DAYS);
  const hrStart = new Date(end.getTime() - cap * DAY_MS);
  const range = (from: Date) => ({
    operator: "between" as const,
    startTime: from.toISOString(),
    endTime: end.toISOString(),
  });
  const out: NativeRecord[] = [];
  const originOf = (r: { metadata?: { dataOrigin?: string } }): string | undefined =>
    r.metadata?.dataOrigin || undefined;

  const hr = await readRecords("HeartRate", { timeRangeFilter: range(hrStart) });
  for (const r of hr.records) {
    for (const s of r.samples) {
      out.push({ type: "heartRate", start: s.time, end: s.time, value: s.beatsPerMinute, origin: originOf(r) });
    }
  }

  const resting = await readRecords("RestingHeartRate", { timeRangeFilter: range(start) });
  for (const r of resting.records) {
    out.push({ type: "restingHR", start: r.time, end: r.time, value: r.beatsPerMinute, origin: originOf(r) });
  }

  const hrv = await readRecords("HeartRateVariabilityRmssd", { timeRangeFilter: range(start) });
  for (const r of hrv.records) {
    out.push({ type: "hrv", start: r.time, end: r.time, value: r.heartRateVariabilityMillis, origin: originOf(r) });
  }

  // Steps/calories/active energy must be per CALENDAR day (midnight →
  // midnight, device timezone), exactly what the watch shows — and per
  // DEVICE (data origin). The watch, the ring and the phone all write steps
  // to Health Connect, so summing across devices double-counts (the same
  // physical steps logged twice). Each origin is bucketed separately and
  // pushed under its own source key; the web app's priority engine then
  // picks ONE device per metric per day (Rule 1 — they measure the same
  // steps, so they must never be summed).
  const dayRanges = localDayRanges(days);
  for (const dr of dayRanges) {
    const dayStartMs = new Date(dr.start).getTime();
    const dayEndMs = new Date(dr.end).getTime();
    const dayFilter = {
      operator: "between" as const,
      startTime: dr.start,
      endTime: dr.end,
    };

    // Steps: group the day's interval records by origin, bucket each origin
    // into hours, and emit per-hour records tagged with that origin. The
    // web app sums ONE origin's hours for the day total — no cross-device
    // inflation, and the same-day "up and down" chart comes for free.
    const stepRecs = await readRecords("Steps", { timeRangeFilter: dayFilter });
    const stepsByOrigin = new Map<string, StepInterval[]>();
    for (const r of stepRecs.records) {
      const o = originOf(r) ?? "unknown";
      if (!stepsByOrigin.has(o)) stepsByOrigin.set(o, []);
      stepsByOrigin.get(o)!.push(r);
    }
    for (const [origin, recs] of stepsByOrigin) {
      const hourly = hourlyBuckets(recs, dayStartMs, dayEndMs);
      if (hourly.length === 1) {
        out.push({ type: "steps", start: dr.start, end: dr.end, value: hourly[0].value, origin });
      } else {
        for (const h of hourly) {
          const hs = new Date(dayStartMs + h.t * 60_000);
          const he = new Date(dayStartMs + (h.t + 1) * 60_000);
          out.push({ type: "steps", start: hs.toISOString(), end: he.toISOString(), value: h.value, origin });
        }
      }
    }

    // Calories + active energy: per-origin day totals from interval records.
    const calRecs = await readRecords("TotalCaloriesBurned", { timeRangeFilter: dayFilter });
    const calByOrigin = new Map<string, number>();
    for (const r of calRecs.records) {
      const o = originOf(r) ?? "unknown";
      calByOrigin.set(o, (calByOrigin.get(o) ?? 0) + (r.energy?.inKilocalories ?? 0));
    }
    for (const [origin, kcal] of calByOrigin) {
      if (kcal > 0) out.push({ type: "calories", start: dr.start, end: dr.end, value: kcal, origin });
    }

    const activeCalRecs = await readRecords("ActiveCaloriesBurned", { timeRangeFilter: dayFilter });
    const activeByOrigin = new Map<string, number>();
    for (const r of activeCalRecs.records) {
      const o = originOf(r) ?? "unknown";
      activeByOrigin.set(o, (activeByOrigin.get(o) ?? 0) + (r.energy?.inKilocalories ?? 0));
    }
    for (const [origin, kcal] of activeByOrigin) {
      if (kcal > 0) out.push({ type: "activeEnergy", start: dr.start, end: dr.end, value: kcal, origin });
    }
  }

  // Sleep — Health Connect stores sleep as sessions with stage segments.
  // Reading rules (each one fixes a real data-integrity bug):
  //  1. UNKNOWN stage minutes count as sleep (the fall-asleep window the
  //     watch still reports as sleep); OUT_OF_BED does not.
  //  2. AWAKE is tracked separately and is NOT part of the sleep total — the
  //     total is time ASLEEP (deep + light + REM), matching what the watch's
  //     own app shows. The web sleep-score engine derives efficiency from
  //     asleep / (asleep + awake), so nothing is lost.
  //  3. Two devices can write the SAME night (watch AND ring both push a
  //     session to Health Connect). Overlapping sessions are merged into one
  //     "night" — the most complete one wins — so a night is never
  //     double-counted or silently split.
  //  4. Sessions without a stage breakdown (some apps write duration only)
  //     fall back to the session span so the night isn't dropped.
  const sleep = await readRecords("SleepSession", { timeRangeFilter: range(start) });
  interface SleepNight {
    start: number;
    end: number;
    deep: number;
    light: number;
    rem: number;
    awake: number;
    total: number; // time asleep (deep + light + rem)
    origin?: string; // the app that wrote the winning session (watch vs ring)
  }
  const nights: SleepNight[] = [];
  for (const r of sleep.records) {
    const origin = originOf(r);
    let deep = 0, light = 0, rem = 0, awake = 0;
    for (const stage of r.stages ?? []) {
      const min = (new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()) / 60000;
      if (min <= 0) continue;
      if (stage.stage === SleepStageType.DEEP) deep += min;
      else if (stage.stage === SleepStageType.REM) rem += min;
      else if (stage.stage === SleepStageType.AWAKE) awake += min;
      else if (stage.stage === SleepStageType.OUT_OF_BED) {
        /* not asleep */
      } else {
        light += min; // LIGHT, SLEEPING, UNKNOWN → sleep
      }
    }
    const spanMin = Math.max(0, (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000);
    if ((r.stages?.length ?? 0) === 0 && spanMin > 0) {
      // No stage breakdown at all — the whole span counts as unclassified sleep.
      light = spanMin;
    }
    const total = deep + light + rem;
    if (total <= 0) continue;
    nights.push({
      start: new Date(r.startTime).getTime(),
      end: new Date(r.endTime).getTime(),
      deep,
      light,
      rem,
      awake,
      total,
      origin,
    });
  }
  // Merge overlapping sessions into nights (watch + ring both write the same
  // night): sessions within 2h of each other are one night; keep the longest.
  // The winner's origin rides along so a ring-only night still shows up as
  // the ring's device (never as an anonymous "Unknown" slot).
  nights.sort((a, b) => a.start - b.start);
  const merged: SleepNight[] = [];
  for (const n of nights) {
    const last = merged[merged.length - 1];
    if (last && n.start < last.end + 2 * 60 * 60 * 1000) {
      if (n.total > last.total) merged[merged.length - 1] = n;
    } else {
      merged.push(n);
    }
  }
  for (const n of merged) {
    out.push({
      type: "sleep",
      start: new Date(n.start).toISOString(),
      end: new Date(n.end).toISOString(),
      value: Math.round(n.total),
      origin: n.origin,
      sleepStages: {
        deepMin: Math.round(n.deep),
        lightMin: Math.round(n.light),
        remMin: Math.round(n.rem),
        awakeMin: Math.round(n.awake),
      },
    });
  }

  const spo2 = await readRecords("OxygenSaturation", { timeRangeFilter: range(hrStart) });
  for (const r of spo2.records) {
    // Health Connect stores oxygen saturation as 0..1 — convert to %.
    out.push({ type: "spo2", start: r.time, end: r.time, value: r.percentage * 100, origin: originOf(r) });
  }

  const temp = await readRecords("BodyTemperature", { timeRangeFilter: range(start) });
  for (const r of temp.records) {
    out.push({ type: "skinTemp", start: r.time, end: r.time, value: r.temperature.inCelsius, origin: originOf(r) });
  }

  return out;
}
