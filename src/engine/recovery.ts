// ---------------------------------------------------------------------------
// Recovery engine (Module 2: Daily Recovery Score 0–100)
//
//   Recovery = w1·f(ΔHRV) + w2·f(ΔRHR) + w3·SleepQuality + w4·f(SkinTemp)
//
// where Δ is today's morning value vs the 7-day rolling baseline, expressed in
// standard deviations, and each f maps the deviation onto 0–100.
// ---------------------------------------------------------------------------

import type { DailyMetrics } from "../types";

export const RECOVERY_WEIGHTS = {
  hrv: 0.35,
  rhr: 0.25,
  sleep: 0.3,
  temp: 0.1,
};

export const RECOVERY_GREEN = 67;
export const RECOVERY_YELLOW = 34;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** z-score of `x` vs baseline using 2 SD as the "full swing" unit. */
function deviation(x: number, baseline: number, sd: number): number {
  if (sd < 1e-6) {
    const d = x - baseline;
    return d === 0 ? 0 : d > 0 ? 1 : -1;
  }
  return (x - baseline) / (2 * sd);
}

export interface RecoveryInputs {
  hrv: number;
  baselineHrv: number;
  sdHrv: number;
  rhr: number;
  baselineRhr: number;
  sdRhr: number;
  sleepScore: number;
  skinTemp: number;
  baselineTemp: number;
  sdTemp: number;
}

export function computeRecovery(i: RecoveryInputs): number {
  // Higher HRV → better recovery.
  const hrvComp = 50 + 50 * clamp(deviation(i.hrv, i.baselineHrv, i.sdHrv), -1, 1);
  // Lower RHR → better recovery.
  const rhrComp = 50 - 50 * clamp(deviation(i.rhr, i.baselineRhr, i.sdRhr), -1, 1);
  const sleepComp = i.sleepScore;
  // Skin temp near baseline → neutral; elevated (or depressed) temp is a signal.
  const tempComp =
    100 - 100 * Math.min(1, Math.abs(deviation(i.skinTemp, i.baselineTemp, i.sdTemp)));

  const score =
    RECOVERY_WEIGHTS.hrv * hrvComp +
    RECOVERY_WEIGHTS.rhr * rhrComp +
    RECOVERY_WEIGHTS.sleep * sleepComp +
    RECOVERY_WEIGHTS.temp * tempComp;

  return clamp(Math.round(score), 0, 100);
}

export function recoveryColor(score: number): "green" | "yellow" | "red" {
  if (score >= RECOVERY_GREEN) return "green";
  if (score >= RECOVERY_YELLOW) return "yellow";
  return "red";
}

/** 7-day rolling baseline (mean + stddev) for a numeric field across days. */
export function baselineAndSd(
  days: DailyMetrics[],
  field: (d: DailyMetrics) => number
): { baseline: number; sd: number } {
  const vals = days.map(field);
  const n = vals.length;
  if (n === 0) return { baseline: 0, sd: 1 };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { baseline: mean, sd: Math.sqrt(variance) };
}

/** Baseline computed from the 7 days *before* `date` (excludes that day). */
export function baselineBefore(
  days: DailyMetrics[],
  date: string,
  field: (d: DailyMetrics) => number,
  window = 7
): { baseline: number; sd: number } {
  const idx = days.findIndex((d) => d.date === date);
  const start = idx < 0 ? 0 : Math.max(0, idx - window);
  const end = idx < 0 ? days.length : idx;
  return baselineAndSd(days.slice(start, end), field);
}
