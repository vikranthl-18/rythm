// ---------------------------------------------------------------------------
// Records & PR engine (Module 3: performance analytics)
// Computes personal records from workout GPS tracks: best time over classic
// distances, longest run, and best rolling 7-day volume.
// ---------------------------------------------------------------------------

import type { RoutePoint, Workout } from "../types";
import { haversineM } from "../lib/geo";
import { activityDef } from "../types";

export const RUN_PRS = [
  { label: "1K", distanceM: 1000 },
  { label: "5K", distanceM: 5000 },
  { label: "10K", distanceM: 10000 },
  { label: "Half marathon", distanceM: 21097.5 },
  { label: "Marathon", distanceM: 42195 },
];

export const CYCLE_PRS = [{ label: "20K", distanceM: 20000 }];

export interface RecordEntry {
  kind: "time" | "distance";
  label: string;
  icon: string;
  /** Primary display value, e.g. "19:12" or "7.80 km". */
  main: string | null;
  /** Secondary value, e.g. "4:02 /km" or "55:04". */
  sub: string | null;
  /** Context line: workout title + date. */
  detail: string | null;
}

/** Time (s) at which a route first reaches `distanceM`, or null if shorter. */
export function timeToDistance(points: RoutePoint[], distanceM: number): number | null {
  if (points.length < 2 || distanceM <= 0) return null;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    if (acc + d >= distanceM) {
      const frac = (distanceM - acc) / d;
      return points[i - 1].t + (points[i].t - points[i - 1].t) * frac;
    }
    acc += d;
  }
  return null;
}

function fmtTime(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtPace(secPerKm: number): string {
  return `${fmtTime(secPerKm)} /km`;
}

function fmtKm(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`;
  return `${Math.round(m)} m`;
}

function bestTimeWorkout(
  workouts: Workout[],
  types: Workout["type"][],
  distanceM: number
): { timeSec: number; w: Workout } | null {
  let best: { timeSec: number; w: Workout } | null = null;
  for (const w of workouts) {
    if (!types.includes(w.type) || w.route.length < 2) continue;
    const t = timeToDistance(w.route, distanceM);
    if (t !== null && (!best || t < best.timeSec)) best = { timeSec: t, w };
  }
  return best;
}

function bestRolling7dKm(workouts: Workout[]): { km: number; endIso: string } | null {
  const sorted = [...workouts].sort((a, b) => a.startIso.localeCompare(b.startIso));
  if (sorted.length === 0) return null;
  let best: { km: number; endIso: string } | null = null;
  for (let i = 0; i < sorted.length; i++) {
    let km = 0;
    const windowStart = new Date(new Date(sorted[i].endIso).getTime() - 7 * 86400000);
    for (let j = i; j >= 0; j--) {
      if (new Date(sorted[j].endIso) < windowStart) break;
      km += sorted[j].distanceM / 1000;
    }
    if (!best || km > best.km) best = { km, endIso: sorted[i].endIso.slice(0, 10) };
  }
  return best;
}

export function computeRecords(workouts: Workout[]): RecordEntry[] {
  const entries: RecordEntry[] = [];
  const dateLabel = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // running PRs (run + trail)
  for (const pr of RUN_PRS) {
    const best = bestTimeWorkout(workouts, ["run", "trail"], pr.distanceM);
    entries.push({
      kind: "time",
      label: pr.label,
      icon: best ? activityDef(best.w.type).icon : "🏃",
      main: best ? fmtTime(best.timeSec) : null,
      sub: best ? fmtPace(best.timeSec / (pr.distanceM / 1000)) : null,
      detail: best ? `${best.w.title} · ${dateLabel(best.w.startIso.slice(0, 10))}` : null,
    });
  }

  // cycling PR
  const bike = bestTimeWorkout(workouts, ["cycle"], 20000);
  entries.push({
    kind: "time",
    label: "20K ride",
    icon: "🚴",
    main: bike ? fmtTime(bike.timeSec) : null,
    sub: bike ? fmtPace(bike.timeSec / 20) : null,
    detail: bike ? `${bike.w.title} · ${dateLabel(bike.w.startIso.slice(0, 10))}` : null,
  });

  // longest run
  const runs = workouts.filter((w) => (w.type === "run" || w.type === "trail") && w.distanceM > 0);
  const longest = runs.length ? runs.reduce((a, b) => (a.distanceM > b.distanceM ? a : b)) : null;
  entries.push({
    kind: "distance",
    label: "Longest run",
    icon: "🥾",
    main: longest ? fmtKm(longest.distanceM) : null,
    sub: longest ? fmtTime(longest.durationSec) : null,
    detail: longest ? `${longest.title} · ${dateLabel(longest.startIso.slice(0, 10))}` : null,
  });

  // best rolling 7-day volume
  const week = bestRolling7dKm(workouts);
  entries.push({
    kind: "distance",
    label: "Best 7 days",
    icon: "📅",
    main: week ? `${week.km.toFixed(1)} km` : null,
    sub: null,
    detail: week ? `week ending ${dateLabel(week.endIso)}` : null,
  });

  return entries;
}
