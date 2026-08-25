// ---------------------------------------------------------------------------
// Baselines engine — every baseline is learned from the *user's own* history.
// The app needs a minimum window of days before a baseline counts as learned;
// until then the UI says "still learning" instead of pretending to know.
// ---------------------------------------------------------------------------

import type { DailyMetrics } from "../types";
import { baselineAndSd } from "./recovery";

export const BASELINE_WINDOW_DAYS = 7;
export const FULL_HISTORY_DAYS = 28; // needed for chronic-load style baselines

export interface UserBaseline {
  value: number;
  sd: number;
  /** how many days of the user's own data the baseline is built from */
  days: number;
  /** true once enough history exists for the baseline to be meaningful */
  learned: boolean;
  /** how many more days until the baseline is learned */
  daysToLearn: number;
}

export function userBaseline(
  days: DailyMetrics[],
  pick: (d: DailyMetrics) => number,
  minDays = BASELINE_WINDOW_DAYS
): UserBaseline {
  const history = days.slice(-minDays);
  const { baseline, sd } = baselineAndSd(history, pick);
  const learned = history.length >= minDays;
  return {
    value: baseline,
    sd,
    days: history.length,
    learned,
    daysToLearn: Math.max(0, minDays - history.length),
  };
}

/** Baseline excluding the most recent day (so "today vs baseline" is honest). */
export function userBaselineBefore(
  days: DailyMetrics[],
  pick: (d: DailyMetrics) => number,
  minDays = BASELINE_WINDOW_DAYS
): UserBaseline {
  return userBaseline(days.slice(0, -1), pick, minDays);
}

export function baselineLabel(b: UserBaseline, unit = ""): string {
  return b.learned
    ? `learned from your last ${b.days} days (${b.value.toFixed(1)}${unit} ± ${b.sd.toFixed(1)})`
    : `still learning — ${b.daysToLearn} more day${b.daysToLearn === 1 ? "" : "s"} of data needed`;
}
