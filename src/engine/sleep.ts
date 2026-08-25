// ---------------------------------------------------------------------------
// Sleep engine (Module 2: Sleep Performance Dashboard)
// ---------------------------------------------------------------------------

import { clamp } from "./recovery";

export interface SleepInput {
  durationMin: number;
  deepMin: number;
  remMin: number;
  awakeMin: number;
  needMin: number;
}

/**
 * Sleep score 0–100:
 *  - 45% duration vs sleep need
 *  - 30% efficiency (time asleep / time in bed)
 *  - 25% deep + REM proportion (peaks around 40% of sleep)
 */
export function computeSleepScore(s: SleepInput): number {
  const durComp = (clamp(s.durationMin / Math.max(1, s.needMin), 0, 1.15) / 1.15) * 100;
  // durationMin is time ASLEEP (deep + light + REM); awake is tracked
  // separately. Efficiency = asleep / (asleep + awake) — this holds whether
  // the caller passes asleep-only (the device pull) or in-bed time (the demo
  // seed), because awake is always subtracted consistently.
  const efficiency = s.durationMin / Math.max(1, s.durationMin + s.awakeMin);
  const effComp = (clamp(efficiency / 0.95, 0, 1)) * 100;
  const deepRemPct = (s.deepMin + s.remMin) / Math.max(1, s.durationMin);
  const drComp = 100 - 100 * Math.min(1, Math.abs(deepRemPct - 0.4) / 0.15);
  return Math.round(clamp(0.45 * durComp + 0.3 * effComp + 0.25 * drComp, 0, 100));
}

/**
 * Sleep need in minutes: baseline 7.5h, plus extra for yesterday's strain
 * (hard training → more recovery needed) and carried-over sleep debt.
 */
export function sleepNeedMin(prevStrain: number, prevDebtMin: number): number {
  const base = 450;
  const strainAdj = Math.max(0, prevStrain - 8) * 7; // +7 min per strain point over 8
  const debtAdj = Math.min(75, prevDebtMin * 0.5);
  return Math.round(base + strainAdj + debtAdj);
}

/** Sleep debt carried into the next night: capped to avoid runaway. */
export function nextSleepDebt(needMin: number, actualMin: number, prevDebtMin: number): number {
  return Math.max(0, Math.min(180, prevDebtMin + (needMin - actualMin)));
}

export function fmtSleep(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 60) return `${h + 1}h`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Sleep coach — actionable tips grounded in the athlete's own sleep numbers.
// ---------------------------------------------------------------------------

export interface SleepTip {
  text: string;
  tone: "good" | "warn" | "bad";
}

/** Tips on how to improve the sleep score, each tied to a real data point. */
export function sleepCoachTips(
  s: SleepInput,
  weekAvgScore: number,
  debtMin: number
): SleepTip[] {
  const tips: SleepTip[] = [];
  const short = s.needMin - s.durationMin;
  const efficiency = (s.durationMin / Math.max(1, s.durationMin + s.awakeMin)) * 100;
  const deepRemPct = ((s.deepMin + s.remMin) / Math.max(1, s.durationMin)) * 100;

  if (short > 30) {
    tips.push({
      tone: "bad",
      text: `You slept ${Math.round(s.durationMin / 6) / 10}h against a ${Math.round(s.needMin / 6) / 10}h need — ${Math.round(short)} min behind, ${debtMin > 60 ? `and ~${Math.round(debtMin)} min of debt is carried over.` : "adding to sleep debt."} Bank one extra hour tonight; it's the single biggest lever on your score.`,
    });
  }
  if (efficiency < 85) {
    tips.push({
      tone: "warn",
      text: `Sleep efficiency is ${Math.round(efficiency)}% — ${Math.round(s.awakeMin)} min awake in bed. A consistent wake-up time (even weekends) trains your body clock and tightens efficiency.`,
    });
  }
  if (deepRemPct < 30) {
    tips.push({
      tone: "warn",
      text: `Only ${Math.round(deepRemPct)}% of sleep is deep + REM (target ≈ 40%). Deep sleep comes earlier — moving bedtime 30–60 min earlier buys the most restorative cycles.`,
    });
  }
  if (weekAvgScore < 67 && weekAvgScore > 0) {
    tips.push({
      tone: "warn",
      text: `Your 7-day sleep average is ${Math.round(weekAvgScore)}/100 — the trend is costing you recovery. Two good nights in a row resets the pattern.`,
    });
  }
  if (tips.length === 0) {
    tips.push({
      tone: "good",
      text: `You're on track — ${Math.round(s.durationMin / 6) / 10}h at ${Math.round(efficiency)}% efficiency with ${Math.round(deepRemPct)}% deep + REM. Protect the routine: same bedtime, cool room, no screens 30 min before.`,
    });
  }
  return tips;
}
