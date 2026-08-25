// ---------------------------------------------------------------------------
// AI analysis for the score sheets.
//
// Every major surface (AI metrics, Rythm Score, training load, readiness) gets
// an "AI analysis" block. Each `*Insight` builder returns an InsightSpec: the
// system prompt (with the athlete's REAL numbers embedded — the model is told
// to ground every claim in them) plus a deterministic fallback answer used
// when no LLM is configured or the call fails. The UI resolves the two via
// llmComplete() (serverless → Gemini → fallback), same as the chat coach.
// ---------------------------------------------------------------------------

import type { CoachContext } from "./coach";
import type { AiInput, AiMetrics } from "./aiMetrics";
import type { RythmScore } from "./rhythm";
import type { LoadBalance, SessionRecommendation } from "./load";
import type { Readiness } from "./readiness";
import { fmtKm } from "../lib/geo";

export interface InsightSpec {
  system: string; // LLM system prompt — the numbers, grounded
  user: string; // the specific ask
  fallback: string; // deterministic answer when the model is unavailable
}

/** Compact athlete snapshot shared by every prompt so the model never has to guess. */
function snapshot(c: CoachContext): string {
  const week =
    c.workouts7.length === 0
      ? "none"
      : c.workouts7
          .map((w) => `${w.title} (${w.when}, ${w.durationMin} min, ${fmtKm(w.km * 1000)}, strain ${w.strain})`)
          .join("; ");
  return [
    `Goal: "${c.goal}" · age ${c.age}.`,
    `Recovery ${c.recovery}/100 (${c.recoveryColor}) · strain today ${c.strain.toFixed(1)} of ${c.strainTarget.toFixed(1)} target.`,
    `HRV ${c.hrv} ms (7-day baseline ${c.hrvBaseline.toFixed(0)}) · resting HR ${c.rhr} bpm (baseline ${c.rhrBaseline.toFixed(0)}).`,
    `Sleep score ${c.sleepScore}, ${(c.sleepMin / 60).toFixed(1)} h vs ${(c.needMin / 60).toFixed(1)} h need (${c.sleepDebtMin} min debt).`,
    `Habits ${c.habitsDone}/${c.habitsDue} done today.`,
    `This week: ${fmtKm(c.weekMileageKm * 1000)}, ${c.weekSessions} sessions, ${c.weekStrain.toFixed(1)} strain.`,
    `Last 7 days: ${week}.`,
  ].join("\n");
}

const RULES =
  "You are rythm's AI analyst. All numbers above are the athlete's real data — ground every claim in them and never invent values. Answer in 3-6 concise, specific sentences for a fitness app. End with the single highest-leverage action for this athlete.";

// ---------------------------------------------------------------------------
// 1. AI performance metrics (VO2max, bio age, fitness score…)
// ---------------------------------------------------------------------------

export function metricsInsight(ai: AiMetrics, input: AiInput, c: CoachContext): InsightSpec {
  const delta = ai.biologicalAge - input.age;
  const weakest = weakestSignal(ai, input);

  const system = [
    snapshot(c),
    "",
    "AI-derived performance metrics (estimates from the athlete's own biometrics):",
    `- VO2max ~${ai.vo2max} mL/kg/min (age/sex norm ~${ai.vo2Expected}, labelled ${ai.vo2Label}, ~${ai.vo2Pct}/100 percentile).`,
    `- Fitness score ${ai.fitnessScore}/100 (${ai.fitnessLabel}) from HRV vs norm, resting HR vs norm, and VO2max percentile.`,
    `- Biological age ~${ai.biologicalAge} yrs vs calendar age ${input.age} (${delta <= 0 ? `${-delta} younger` : `${delta} older`}).`,
    `- Cardio age ~${ai.cardioAge} yrs.`,
    `- Training status: ${ai.trainingStatus} (3-day recovery trend ${ai.recoveryTrend}%, avg daily strain ${ai.weeklyLoad}).`,
    `- Resting metabolic rate ~${ai.rmrKcal} kcal/day (Mifflin-St Jeor from ${input.weightKg} kg, ${input.heightCm} cm, age ${input.age}).`,
    "",
    RULES,
    "",
    "Task: sanity-check these estimates against each other and the context — flag anything internally inconsistent. Then explain in plain language what these numbers mean for THIS athlete's goal, and give 2-3 concrete ways to improve the weakest signal. Be honest that these are wearable-based estimates, not lab measurements.",
  ].join("\n");

  return {
    system,
    user: "Review my AI metrics.",
    fallback: metricsFallback(ai, input, weakest),
  };
}

function weakestSignal(ai: AiMetrics, input: AiInput): { label: string; gap: number; lever: string } {
  const candidates = [
    { label: "VO₂max", gap: ai.vo2Expected - ai.vo2max, lever: "two steady zone-2 sessions a week are the fastest known way to raise aerobic capacity" },
    { label: "resting HR", gap: input.restingHR - ai.rhrNorm, lever: "consistent sleep and easy aerobic volume nudge resting HR down over weeks" },
    { label: "HRV", gap: ai.hrvNorm - input.hrv, lever: "HRV responds to sleep, hydration, and low evening stress — protect the wind-down hour" },
  ];
  candidates.sort((a, b) => b.gap - a.gap);
  return candidates[0];
}

function metricsFallback(ai: AiMetrics, input: AiInput, weakest: { label: string; gap: number; lever: string }): string {
  const delta = ai.biologicalAge - input.age;
  const ageNote =
    delta <= 0
      ? `your biological age (~${ai.biologicalAge} yrs) is ${-delta} yrs younger than your calendar age of ${input.age}`
      : `your biological age (~${ai.biologicalAge} yrs) runs ${delta} yrs older than your calendar age of ${input.age}`;
  return `Your VO₂max estimate is ${ai.vo2max} mL/kg/min — ${ai.vo2Label.toLowerCase()} for a ${input.sex} your age (norm ≈ ${ai.vo2Expected}) — and ${ageNote}. The numbers are internally consistent: resting HR ${input.restingHR} bpm (norm ≈ ${ai.rhrNorm}) and HRV ${input.hrv} ms (norm ≈ ${ai.hrvNorm}) support a "${ai.trainingStatus}" status at ${ai.weeklyLoad} avg daily strain. The weakest signal right now is ${weakest.label} (gap ${weakest.gap >= 0 ? "+" : ""}${Math.round(weakest.gap * 10) / 10} vs norm): ${weakest.lever}. These are wearable estimates, not lab tests — retest trends over weeks, not days.`;
}

// ---------------------------------------------------------------------------
// 2. Rythm Score
// ---------------------------------------------------------------------------

export function rhythmInsight(rythm: RythmScore, c: CoachContext): InsightSpec {
  const system = [
    snapshot(c),
    "",
    `Rythm Score: ${rythm.score}/100 (${rythm.color}). Six weighted pillars:`,
    ...rythm.parts.map((p) => `- ${p.label} ${p.score}/100 (weight ${Math.round(p.weight * 100)}%) — ${p.reason}`),
    "",
    RULES,
    "",
    "Task: in 3-6 sentences explain why the score is what it is — which pillars are carrying it and which are dragging it down, given the athlete's goal — then give the top 3 actions to raise it, prioritized by pillar weight × gap.",
  ].join("\n");

  return {
    system,
    user: "Why is my Rythm Score what it is, and what should I do to raise it?",
    fallback: rhythmFallback(rythm),
  };
}

function rhythmFallback(rythm: RythmScore): string {
  // The fastest lever is the pillar with the biggest weighted gap.
  const ranked = [...rythm.parts]
    .map((p) => ({ p, gap: (100 - p.score) * p.weight }))
    .sort((a, b) => b.gap - a.gap);
  const top = ranked.slice(0, 2);
  const lows = top
    .map((r) => `${r.p.label} (${r.p.score}/100, ${Math.round(r.p.weight * 100)}% weight)`)
    .join(" and ");
  const highs = rythm.parts
    .filter((p) => p.score >= 67)
    .map((p) => p.label)
    .join(", ");
  return `Your Rythm Score is ${rythm.score}/100 (${rythm.color}). ${
    highs ? `The score is being carried by ${highs}. ` : ""
  }The fastest way to raise it is to lift the weakest weighted pillar${top.length > 1 ? "s" : ""} — ${lows}. ${top[0].p.improve} One bad night can't sink a good week: the blend weights nothing above 25%, so consistent small wins beat any single heroic effort.`;
}

// ---------------------------------------------------------------------------
// 3. Training load & fitness balance
// ---------------------------------------------------------------------------

export function loadInsight(
  load: LoadBalance,
  recovery: number,
  rec: SessionRecommendation,
  c: CoachContext
): InsightSpec {
  const system = [
    snapshot(c),
    "",
    `Training load: acute (7-day avg) ${load.acute}, chronic (28-day avg) ${load.chronic}, ratio ${load.acwr} (status: ${load.status}, learned from ${load.chronicDays} days of history).`,
    `Today's recovery: ${recovery}/100.`,
    "",
    RULES,
    "",
    "Task: interpret this athlete's fitness–fatigue balance for their goal — is the ratio building fitness, treading water, or stacking fatigue? Say whether today (and this week) should push or back off, and name the specific session type that fits.",
  ].join("\n");

  return {
    system,
    user: "Is my training load balanced, and what should my session be?",
    fallback: `${rec.title}: ${rec.body} With a ${load.acwr.toFixed(2)}× ratio (${load.status.toLowerCase()}) and recovery at ${recovery}%, the load signal says ${load.acwr > 1.3 ? "ease off before fatigue compounds" : load.acwr < 0.8 ? "your body is adapted and ready for more stimulus" : "you're in the safe building zone — keep the cadence"}.${load.learned ? "" : " The 28-day baseline is still learning — these reads firm up as history accumulates."}`,
  };
}

// ---------------------------------------------------------------------------
// 4. Readiness
// ---------------------------------------------------------------------------

export function readinessInsight(readiness: Readiness, c: CoachContext): InsightSpec {
  const system = [
    snapshot(c),
    "",
    `Readiness: ${readiness.score}/100 (${readiness.status}). Components — ${readiness.parts
      .map((p) => `${p.label} ${Math.round(p.score)}/100 (${Math.round(p.weight * 100)}%)`)
      .join(", ")}.`,
    `Verdict: ${readiness.verdict}`,
    "",
    RULES,
    "",
    "Task: give a 2-4 sentence verdict on how ready the athlete is to train right now, which component is the limiting factor, and exactly what today's session should look like.",
  ].join("\n");

  return {
    system,
    user: "How ready am I to train right now?",
    fallback: `${readiness.verdict} The limiting factor is ${
      readiness.parts.sort((a, b) => a.score - b.score)[0].label
    } — that's where the marginal gain is. ${readiness.status === "Ready" ? "Bank the good window: quality work today, easy tomorrow." : readiness.status === "Moderate" ? "Keep today controlled — one solid zone-2 block, then reassess tomorrow morning." : "Protect the red: rest, hydrate, and make tonight's sleep the workout."}`,
  };
}
