// ---------------------------------------------------------------------------
// Goals engine — turn the user's stated goal into measurable progress.
// Each goal has milestones ("done") and a concrete plan ("todo"), computed
// from the user's actual workouts, routes and volume.
// ---------------------------------------------------------------------------

import type { Workout } from "../types";
import { timeToDistance } from "./records";

export interface GoalDef {
  id: string;
  label: string;
  icon: string;
  targetText: string;
}

export const GOALS: GoalDef[] = [
  { id: "sub20-5k", label: "Sub-20 min 5K", icon: "⚡", targetText: "5 km in under 20:00" },
  { id: "half-marathon", label: "Half marathon", icon: "🏅", targetText: "Run 21.1 km" },
  { id: "marathon", label: "First marathon", icon: "🎽", targetText: "Run 42.2 km" },
  { id: "century", label: "Century ride", icon: "🚴", targetText: "Ride 100 km in one go" },
  { id: "month-100k", label: "100 km month", icon: "📆", targetText: "100 km total this month" },
];

/** Match a free-text goal to a defined goal (best-effort). */
export function matchGoal(goal: string): GoalDef | null {
  const g = goal.toLowerCase();
  if (g.includes("half") || g.includes("21.1") || g.includes("21 km")) return GOALS[1];
  if (g.includes("marathon")) return GOALS[2];
  if (g.includes("century") || g.includes("100 km") || g.includes("100km") || g.includes("metric century"))
    return GOALS[3];
  if (g.includes("month") || g.includes("100k")) return GOALS[4];
  if (g.includes("5k") || g.includes("5 km") || g.includes("20")) return GOALS[0];
  return null;
}

export interface GoalContext {
  workouts: Workout[];
  todayIso: string; // YYYY-MM-DD
}

export interface GoalProgress {
  goal: GoalDef;
  pct: number; // 0–100
  headline: string;
  current: string; // where you are right now
  done: string[]; // everything you've already achieved
  todo: string[]; // everything left to do
}

const RUN = ["run", "trail"] as const;
const fmtKm = (m: number) => `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`;
const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function longestDistance(workouts: Workout[], types: readonly string[]): { m: number; title: string } {
  let best = { m: 0, title: "" };
  for (const w of workouts) {
    if (!types.includes(w.type) || w.distanceM <= best.m) continue;
    best = { m: w.distanceM, title: w.title };
  }
  return best;
}

function bestTimeOver(workouts: Workout[], types: readonly string[], distM: number): number | null {
  let best: number | null = null;
  for (const w of workouts) {
    if (!types.includes(w.type) || w.route.length < 2) continue;
    const t = timeToDistance(w.route, distM);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

function weekKm(workouts: Workout[], todayIso: string): number {
  const sixAgo = new Date(todayIso);
  sixAgo.setDate(sixAgo.getDate() - 6);
  const cutoff = sixAgo.toISOString().slice(0, 10);
  return workouts
    .filter((w) => w.startIso.slice(0, 10) >= cutoff)
    .reduce((a, w) => a + w.distanceM, 0);
}

function monthKm(workouts: Workout[], todayIso: string): number {
  const month = todayIso.slice(0, 7);
  return workouts
    .filter((w) => w.startIso.slice(0, 7) === month)
    .reduce((a, w) => a + w.distanceM, 0);
}

export function computeGoalProgress(goalId: string, ctx: GoalContext): GoalProgress | null {
  const goal = GOALS.find((g) => g.id === goalId);
  if (!goal) return null;
  const { workouts, todayIso } = ctx;
  const wk = weekKm(workouts, todayIso);

  switch (goal.id) {
    case "sub20-5k": {
      const best = bestTimeOver(workouts, RUN, 5000);
      const targetSec = 20 * 60;
      const pct = best ? Math.round(Math.min(100, (targetSec / best) * 100)) : 0;
      const pace = best ? best / 5 : null;
      const headline = best
        ? `${pct}% of the way — best 5K ${fmtTime(best)} against a ${fmtTime(targetSec)} target.`
        : "No 5K yet — your first recorded 5K sets the baseline.";
      return {
        goal,
        pct,
        headline,
        current: best
          ? `Best 5K: ${fmtTime(best)} (${fmtTime(pace!)}/km). Target pace: ${fmtTime(targetSec / 5)}/km.`
          : `Weekly volume ${fmtKm(wk)} — you're building the base that a fast 5K sits on.`,
        done: [
          best ? `Recorded a 5K best of ${fmtTime(best)}` : "Started training consistently",
          `Weekly volume ${fmtKm(wk)}`,
          `${workouts.filter((w) => RUN.includes(w.type as (typeof RUN)[number])).length} runs in the log`,
        ],
        todo: [
          "Add 5 × 1 km reps at goal pace (4:00/km) with 2 min jog recovery",
          "One tempo run a week: 3–4 km at ~4:20/km",
          `Build the long run to 8 km to harden the aerobic base`,
          `Bring the 5K effort to ${fmtTime(targetSec)} or faster`,
        ],
      };
    }
    case "half-marathon":
    case "marathon": {
      const target = goal.id === "half-marathon" ? 21097.5 : 42195;
      const longest = longestDistance(workouts, RUN);
      const pct = Math.min(100, Math.round((longest.m / target) * 100));
      const milestones =
        goal.id === "half-marathon"
          ? ["Long run 8 km", "Long run 10 km", "Long run 13 km", "Long run 16 km", "Long run 21.1 km"]
          : ["Long run 10 km", "Long run 16 km", "Long run 24 km", "Long run 32 km", "Long run 42.2 km"];
      const reached = Math.min(milestones.length, Math.floor((longest.m / 1000) / 3) + 1);
      return {
        goal,
        pct,
        headline:
          pct === 100
            ? `Done — your longest run (${fmtKm(longest.m)}) cleared ${goal.targetText.toLowerCase()}.`
            : `${pct}% there — longest run ${fmtKm(longest.m)} of ${goal.targetText.toLowerCase()}.`,
        current: `Longest run: ${fmtKm(longest.m)} (${longest.title || "—"}). Weekly volume ${fmtKm(wk)}.`,
        done: milestones.slice(0, reached),
        todo: milestones.slice(reached),
      };
    }
    case "century": {
      const longest = longestDistance(workouts, ["cycle"]);
      const pct = Math.min(100, Math.round((longest.m / 100000) * 100));
      return {
        goal,
        pct,
        headline:
          pct === 100
            ? "Done — you've ridden 100 km in one go."
            : `${pct}% there — longest ride ${fmtKm(longest.m)} of 100 km.`,
        current: `Longest ride: ${fmtKm(longest.m)}. ` + (wk > 0 ? `You've covered ${fmtKm(wk)} across all workouts this week.` : ""),
        done: [longest.m > 0 ? `Longest ride ${fmtKm(longest.m)}` : "Started riding", "Riding consistently"],
        todo: ["Ride 30 km in one go", "Ride 50 km in one go", "Ride 75 km in one go", "Ride 100 km in one go"],
      };
    }
    case "month-100k": {
      const m = monthKm(workouts, todayIso);
      const pct = Math.min(100, Math.round((m / 100000) * 100));
      const remaining = Math.max(0, 100000 - m);
      return {
        goal,
        pct,
        headline: `${pct}% of the monthly target — ${fmtKm(m)} of 100 km this month.`,
        current: `${fmtKm(m)} so far this month (target 100 km).`,
        done: [`${fmtKm(m)} logged in ${todayIso.slice(0, 7)}`],
        todo: [
          remaining > 0 ? `${fmtKm(remaining)} left this month` : "Target hit — stretch to 120 km",
          "Aim for ~25 km per week to stay on pace",
        ],
      };
    }
    default:
      return null;
  }
}

/** Icon + label for a goal-derived activity family (used by post-workout insight). */
export function goalActivityFamily(goalId: string): "run" | "ride" | "any" {
  if (goalId === "century") return "ride";
  if (goalId === "sub20-5k" || goalId === "half-marathon" || goalId === "marathon") return "run";
  return "any";
}
