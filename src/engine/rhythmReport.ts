// ---------------------------------------------------------------------------
// Rythm Report — the month in one card. A Spotify-Wrapped-style summary built
// from what the app already knows: the score trend (a daily blend of the
// pillars we have per day), training volume, personal records and the sleep
// story. Rendered as a shareable card on the Home screen.
// ---------------------------------------------------------------------------

import type { DailyMetrics, Workout } from "../types";

export interface ReportPr {
  label: string; // "5K" / "10K" / "Half marathon" / "Marathon"
  paceSecPerKm: number | null;
  distanceKm: number;
  date: string;
}

export interface RythmReport {
  windowDays: number;
  trend: { date: string; score: number }[];
  avgScore: number;
  totalKm: number;
  sessions: number;
  bestWeekKm: number;
  longestRunKm: number;
  prs: ReportPr[];
  sleep: { avgMin: number; needMin: number; debtMin: number; nights: number; goodNights: number };
  goal: string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * A per-day approximation of the Rythm Score using only the pillars that have
 * history: recovery, sleep, activity (steps + zone minutes) and training
 * load (strain vs a target). Habits/consistency need live state, so they're
 * folded into the training pillar's rest-day handling instead.
 */
export function dailyRythmTrend(d: DailyMetrics): number {
  const activity = clamp((d.steps / 8000) * 50 + (d.activeZoneMin / 150) * 50);
  const training = d.strain > 0 ? clamp(70 + d.strain * 2) : 40; // rest days aren't bad
  return Math.round(0.3 * d.recovery + 0.3 * d.sleep.score + 0.2 * activity + 0.2 * training);
}

function dayDiff(aIso: string, bIso: string): number {
  return Math.round(
    (new Date(bIso + "T00:00:00").getTime() - new Date(aIso + "T00:00:00").getTime()) / 86400000
  );
}

export function buildRythmReport(
  days: DailyMetrics[],
  workouts: Workout[],
  goal: string
): RythmReport {
  const win = days.slice(-30);
  const trend = win.map((d) => ({ date: d.date, score: dailyRythmTrend(d) }));
  const scored = trend.filter((t) => t.score > 0);
  const avgScore = scored.length
    ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length)
    : 0;

  const totalKm = workouts.reduce((a, w) => a + w.distanceM / 1000, 0);
  const sessions = workouts.length;
  const longestRunKm = Math.max(
    0,
    ...workouts.filter((w) => w.type === "run" || w.type === "trail").map((w) => w.distanceM / 1000)
  );

  // Best rolling 7-day mileage window.
  const kmByDay = new Map<string, number>();
  for (const w of workouts) {
    const d = w.startIso.slice(0, 10);
    kmByDay.set(d, (kmByDay.get(d) ?? 0) + w.distanceM / 1000);
  }
  const dates = [...kmByDay.keys()].sort();
  let bestWeekKm = 0;
  for (let i = 0; i < dates.length; i++) {
    let km = 0;
    for (let j = i; j < dates.length && dayDiff(dates[i], dates[j]) <= 6; j++) {
      km += kmByDay.get(dates[j]) ?? 0;
    }
    bestWeekKm = Math.max(bestWeekKm, km);
  }

  // PRs — fastest pace for each standard distance bucket (within ±25%).
  const buckets = [
    { label: "5K", km: 5 },
    { label: "10K", km: 10 },
    { label: "Half marathon", km: 21.0975 },
    { label: "Marathon", km: 42.195 },
  ];
  const prs: ReportPr[] = buckets.map((b) => {
    let best: { pace: number; w: Workout } | null = null;
    for (const w of workouts) {
      const km = w.distanceM / 1000;
      if (km < b.km * 0.8 || km > b.km * 1.25) continue;
      const pace = w.durationSec / km;
      if (!best || pace < best.pace) best = { pace, w };
    }
    return {
      label: b.label,
      paceSecPerKm: best?.pace ?? null,
      distanceKm: best ? best.w.distanceM / 1000 : b.km,
      date: best ? best.w.startIso.slice(0, 10) : "",
    };
  });

  // Sleep story over the window.
  const sleeps = win.filter((d) => d.sleep.durationMin > 0);
  const nights = sleeps.length;
  const avgMin = nights
    ? Math.round(sleeps.reduce((a, d) => a + d.sleep.durationMin, 0) / nights)
    : 0;
  const needMin = nights
    ? Math.round(sleeps.reduce((a, d) => a + Math.max(1, d.sleep.needMin), 0) / nights)
    : 420;
  const debtMin = sleeps.reduce(
    (a, d) => a + Math.max(0, Math.max(1, d.sleep.needMin) - d.sleep.durationMin),
    0
  );
  const goodNights = sleeps.filter((d) => d.sleep.score >= 67).length;

  return {
    windowDays: win.length,
    trend,
    avgScore,
    totalKm: Math.round(totalKm * 10) / 10,
    sessions,
    bestWeekKm: Math.round(bestWeekKm * 10) / 10,
    longestRunKm: Math.round(longestRunKm * 10) / 10,
    prs,
    sleep: { avgMin, needMin, debtMin, nights, goodNights },
    goal,
  };
}

/** One-tap share text for the report card (Web Share API / clipboard). */
export function reportShareText(r: RythmReport): string {
  const prLine = r.prs
    .filter((p) => p.paceSecPerKm)
    .map((p) => {
      const m = Math.floor(p.paceSecPerKm! / 60);
      const s = String(Math.round(p.paceSecPerKm! % 60)).padStart(2, "0");
      return `${p.label} ${m}:${s}/km`;
    })
    .join(" · ");
  const sleepLine = r.sleep.nights
    ? `Sleep avg ${Math.round(r.sleep.avgMin / 60 * 10) / 10}h (${r.sleep.goodNights}/${r.sleep.nights} good nights)`
    : "No sleep data yet";
  return [
    `My rythm report — ${r.avgScore}/100 score trend`,
    `${r.sessions} sessions · ${r.totalKm} km · best week ${r.bestWeekKm} km`,
    prLine,
    sleepLine,
    r.goal ? `Training for: ${r.goal}` : "",
    "Made with rythm — the app that knows how hard you can push today.",
  ]
    .filter(Boolean)
    .join("\n");
}
