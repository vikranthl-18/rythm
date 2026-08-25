// ---------------------------------------------------------------------------
// Weekly digest — the Monday-morning retrospective. Four paragraphs grounded
// in the user's actual last-7-days data: what happened, recovery & sleep,
// what didn't go well, and next week's plan. The LLM path (via llmComplete)
// writes richer prose when configured; a deterministic engine always works.
// ---------------------------------------------------------------------------

import type { DailyMetrics, Habit, Workout } from "../types";
import { activityDef } from "../types";
import { llmComplete } from "./coach";
import { computeLoadBalance, recommendSession } from "./load";
import { weeklyComparison } from "./weekly";
import { fmtDuration, fmtKm } from "../lib/geo";

export interface Digest {
  paragraphs: string[];
  ai: boolean;
}

export interface DigestInput {
  days: DailyMetrics[];
  workouts: Workout[];
  habits: Habit[];
  todayIso: string;
  goal: string;
}

const fmtPct = (n: number) => `${Math.round(n)}%`;

/** Deterministic four-paragraph retrospective — always available. */
export function buildDigestFallback(input: DigestInput): Digest {
  const { days, workouts, habits, todayIso, goal } = input;
  const week = days.slice(-7);
  const prev = days.slice(-14, -7);
  const avg = (arr: DailyMetrics[], f: (d: DailyMetrics) => number) =>
    arr.length ? arr.reduce((a, d) => a + f(d), 0) / arr.length : 0;

  const wk = weeklyComparison({ workouts, habits, days, todayIso });
  const load = computeLoadBalance(days);
  const rec = recommendSession(avg(week, (d) => d.recovery), load);

  // 1 — what happened (volume + highlights)
  const best = [...workouts]
    .filter((w) => w.startIso.slice(0, 10) >= week[0]?.date)
    .sort((a, b) => b.distanceM - a.distanceM)[0];
  let p1 = `You logged ${wk.thisWeek.sessions} session${wk.thisWeek.sessions === 1 ? "" : "s"}, ${fmtKm(wk.thisWeek.km)} and ${fmtDuration(wk.thisWeek.sec)} of work this week`;
  if (best && best.distanceM > 0) p1 += `, capped by the ${fmtKm(best.distanceM)} ${activityDef(best.type).label.toLowerCase()} (${best.title})`;
  p1 += `. ${wk.sessionsDelta > 0 ? `That's ${wk.sessionsDelta} more session${wk.sessionsDelta === 1 ? "" : "s"} than last week.` : wk.sessionsDelta < 0 ? `That's ${Math.abs(wk.sessionsDelta)} fewer than last week.` : "Same volume as last week."}`;

  // 2 — recovery & sleep
  const recAvg = avg(week, (d) => d.recovery);
  const hrvAvg = avg(week, (d) => d.hrv);
  const sleepAvg = avg(week, (d) => d.sleep.durationMin);
  const sleepNeed = avg(week, (d) => d.sleep.needMin);
  const debtMin = Math.max(0, Math.round(sleepNeed - sleepAvg));
  const recTrend = recAvg - avg(prev, (d) => d.recovery);
  let p2 = `Average recovery was ${fmtPct(recAvg)} (${recTrend >= 0 ? "up" : "down"} ${Math.abs(recTrend).toFixed(0)} pts vs the prior week) with HRV around ${Math.round(hrvAvg)} ms`;
  p2 += ` and ${Math.round(sleepAvg / 60)}h ${Math.round(sleepAvg % 60)}m of sleep per night${debtMin > 0 ? ` — a running sleep debt of about ${debtMin} min/night` : ""}.`;

  // 3 — what didn't go well
  const missList: string[] = [];
  const weakest = [...week].sort((a, b) => a.recovery - b.recovery)[0];
  if (weakest && weakest.recovery < 60) missList.push(`recovery dipped to ${weakest.recovery} on ${weakest.date.slice(5)}`);
  if (debtMin > 0) missList.push(`sleep debt kept building (${debtMin} min/night)`);
  const habitsDue = wk.thisWeek.habitsDue;
  if (habitsDue > 0 && wk.consistencyPct < 100)
    missList.push(`habit consistency sat at ${wk.consistencyPct}% (${wk.thisWeek.habitsDone}/${habitsDue})`);
  if (missList.length === 0) missList.push("nothing major — consistency held all week");
  let p3 = `The friction points: ${missList.join("; ")}.`;

  // 4 — next week
  let p4 = `Next week: ${rec.title.toLowerCase()} — ${rec.body}`;
  if (goal.trim()) p4 += ` Keep ${goal.trim()} front of mind when choosing sessions.`;
  p4 += ` Your load ratio is ${load.acwr.toFixed(2)}× (${load.status.toLowerCase()}), so ${load.status === "Overloading" || load.status === "Spiking" ? "protect recovery this week" : "there's room to build"}.`;

  return { paragraphs: [p1, p2, p3, p4], ai: false };
}

/** LLM-written digest when a model path is configured; fallback otherwise. */
export async function buildDigest(input: DigestInput): Promise<Digest> {
  const fallback = buildDigestFallback(input);
  const numbers = {
    days: input.days.slice(-7).map((d) => ({
      date: d.date,
      recovery: d.recovery,
      strain: d.strain,
      hrv: d.hrv,
      restingHR: d.restingHR,
      sleepMin: d.sleep.durationMin,
      sleepScore: d.sleep.score,
    })),
    weekKm: Math.round(input.workouts
      .filter((w) => w.startIso.slice(0, 10) >= input.days.slice(-7)[0]?.date)
      .reduce((a, w) => a + w.distanceM, 0)),
    sessions: input.workouts.filter((w) => w.startIso.slice(0, 10) >= input.days.slice(-7)[0]?.date).length,
    goal: input.goal,
  };
  const system =
    "You are rythm's weekly training coach. Write a 4-paragraph retrospective (short paragraphs, direct, motivating, no headers, no bullets) using ONLY the numbers provided: (1) what happened this week, (2) recovery & sleep, (3) what didn't go well, (4) a concrete plan for next week grounded in the data. Never invent metrics.";
  const reply = await llmComplete(system, [{ role: "user", text: JSON.stringify(numbers) }]);
  if (!reply) return fallback;
  const paragraphs = reply
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (paragraphs.length < 3) return fallback;
  return { paragraphs, ai: true };
}
