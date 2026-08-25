// ---------------------------------------------------------------------------
// Post-workout insight — after a workout, tell the athlete what went well,
// whether it moved them toward their goal (only when related), and what to do
// tomorrow — grounded in their actual session, recovery and load balance.
// ---------------------------------------------------------------------------

import type { Workout } from "../types";
import { computeGoalProgress, goalActivityFamily, matchGoal, type GoalProgress } from "./goals";
import { recommendSession, type LoadBalance } from "./load";

export interface InsightContext {
  goalText: string; // profile goal
  workouts: Workout[];
  recovery: number; // today's recovery 0–100
  load: LoadBalance;
  todayIso: string;
}

export interface WorkoutInsight {
  good: string[];
  goalNote: string | null;
  goalProgress: GoalProgress | null;
  tomorrow: string;
}

/** Seconds per km → "5:45/km". */
function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function workoutInsight(w: Workout, ctx: InsightContext): WorkoutInsight {
  const goal = matchGoal(ctx.goalText);
  const goalProgress = goal ? computeGoalProgress(goal.id, { workouts: ctx.workouts, todayIso: ctx.todayIso }) : null;

  // --- what went well -------------------------------------------------------
  const good: string[] = [];
  const z3plusMin = w.zones.z3 + w.zones.z4 + w.zones.z5;
  if (z3plusMin >= 10) {
    good.push(`${z3plusMin} min in Z3–Z5 — real training stimulus, not just miles.`);
  } else if (w.durationSec >= 1800) {
    good.push(`A ${Math.round(w.durationSec / 60)}-min session — solid aerobic volume.`);
  } else {
    good.push(`Session completed — every workout builds the habit.`);
  }
  if (w.strain >= 8) good.push(`Strain ${w.strain.toFixed(1)} is a meaningful dose — your body will adapt and recover.`);
  const sessions7 = ctx.workouts.filter(
    (x) => new Date(x.startIso).getTime() >= Date.now() - 7 * 86400000
  ).length;
  if (sessions7 >= 3) good.push(`${sessions7} sessions this week — consistency is the real superpower.`);

  // --- goal note (only if the workout family matches the goal) --------------
  let goalNote: string | null = null;
  if (goal && goalProgress) {
    const family = goalActivityFamily(goal.id);
    const related =
      family === "any" ? w.distanceM > 0 : family === "run" ? w.type === "run" || w.type === "trail" : w.type === "cycle";
    if (related) {
      if (goal.id === "sub20-5k") {
        const pace = w.distanceM > 0 ? w.durationSec / (w.distanceM / 1000) : null;
        goalNote = pace
          ? `This run came in at ${fmtPace(pace)} vs your ${goal.targetText} target pace of 4:00/km. It built aerobic base; the gap closes with weekly rep work.`
          : `This session builds the engine behind a ${goal.targetText.toLowerCase()} — keep stacking quality runs.`;
      } else if (goal.id === "half-marathon" || goal.id === "marathon") {
        goalNote = `Longest run is now ${(goalProgress.current.match(/[0-9.]+ km/) ?? ["—"])[0]} — ${goalProgress.pct}% of the way to ${goal.targetText.toLowerCase()}. Every run pushes the milestone forward.`;
      } else if (goal.id === "century") {
        goalNote = `This ride adds to the log — longest ride ${(goalProgress.current.match(/[0-9.]+ km/) ?? ["—"])[0]}, ${goalProgress.pct}% of the way to 100 km.`;
      } else if (goal.id === "month-100k") {
        goalNote = `This adds ${(w.distanceM / 1000).toFixed(1)} km to your monthly total — ${goalProgress.pct}% of the 100 km target.`;
      }
    }
  }

  // --- tomorrow -------------------------------------------------------------
  const rec = recommendSession(ctx.recovery, ctx.load);
  const tomorrow = `${rec.title}: ${rec.body}`;

  return { good, goalNote, goalProgress, tomorrow };
}
