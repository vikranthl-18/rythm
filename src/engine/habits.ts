// ---------------------------------------------------------------------------
// Habit engine (Module 4: Notion-style habit tracker)
//   - due-day logic (daily / weekdays / custom days + times-per-week)
//   - streak + completion-rate calculations
//   - biometric auto-completion ("Sleep 8 hours" auto-checks from wearables)
// ---------------------------------------------------------------------------

import type { DailyMetrics, Habit } from "../types";
import { addDaysIso, dateFromIso, todayIso, weekdayOf } from "../lib/rng";

export function habitDueOn(h: Habit, iso: string): boolean {
  const wd = weekdayOf(iso);
  switch (h.frequency) {
    case "DAILY":
      return true;
    case "WEEKDAYS":
      return wd >= 1 && wd <= 5;
    case "CUSTOM":
      return h.customDays.includes(wd);
    default:
      return false;
  }
}

export function isCompleted(h: Habit, iso: string): boolean {
  const v = h.logs[iso];
  if (v === undefined) return false;
  if (h.targetType === "BOOLEAN") return v >= 1;
  return v >= h.targetValue;
}

/** Monday of the ISO week containing `iso`. */
export function weekStartOf(iso: string): string {
  const d = dateFromIso(iso);
  const wd = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - wd);
  return todayIso(d);
}

export function addDaysIsoUtc(iso: string, n: number): string {
  return addDaysIso(iso, n);
}

/** Value the auto-sync metric would record for `day`, or null. */
export function autoMetricValue(
  h: Habit,
  day: DailyMetrics | null
): number | null {
  if (!h.autoMetric || !day) return null;
  switch (h.autoMetric) {
    case "sleepDuration":
    case "sleep":
      return day.sleep.durationMin;
    case "steps":
      return day.steps;
    case "hrv":
      return day.hrv;
    case "restingHR":
      return day.restingHR;
    case "skinTemp":
      return day.skinTemp;
    case "spo2":
      return day.spo2;
    case "respRate":
      return day.respRate;
    case "activeEnergy":
      return day.activeEnergy;
    default:
      return null; // "hr" and anything else have no stored daily value
  }
}

/** Would the habit auto-complete from biometrics on this day? */
export function autoCompleted(h: Habit, day: DailyMetrics | null): boolean {
  const v = autoMetricValue(h, day);
  if (v === null) return false;
  return h.autoOp === "lte" ? v <= h.targetValue : v >= h.targetValue;
}

export interface HabitOpts {
  /** allow biometric auto-completion (default true) — set false when the user disabled it */
  auto?: boolean;
}

/**
 * Completion state of a habit on `iso`: an explicit log wins; otherwise today
 * can be auto-completed from live biometrics (unless the user disabled it).
 */
export function completedOn(
  h: Habit,
  iso: string,
  today: string,
  todayDay: DailyMetrics | null,
  opts?: HabitOpts
): boolean {
  if (iso > today) return false;
  if (h.logs[iso] !== undefined) return isCompleted(h, iso);
  if (iso === today && todayDay && h.autoMetric && (opts?.auto ?? true))
    return autoCompleted(h, todayDay);
  return false;
}

function weeklyCompleted(
  h: Habit,
  weekStart: string,
  today: string,
  todayDay: DailyMetrics | null,
  opts?: HabitOpts
): boolean {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(weekStart, i);
    if (iso > today) break;
    if (completedOn(h, iso, today, todayDay, opts)) count++;
  }
  return count >= h.timesPerWeek;
}

/** Days completed in the current week, for the grid footer. */
export function weekProgress(
  h: Habit,
  today: string,
  todayDay: DailyMetrics | null,
  opts?: HabitOpts
): { done: number; target: number } {
  const ws = weekStartOf(today);
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(ws, i);
    if (iso > today) break;
    if (completedOn(h, iso, today, todayDay, opts)) done++;
  }
  return { done, target: h.timesPerWeek || 1 };
}

export function currentStreak(
  h: Habit,
  today: string,
  todayDay: DailyMetrics | null,
  opts?: HabitOpts
): number {
  if (h.frequency === "CUSTOM") {
    let streak = 0;
    let ws = weekStartOf(today);
    // don't count the current week until it's over
    let start = addDaysIso(ws, -7);
    for (let i = 0; i < 104; i++) {
      if (weeklyCompleted(h, start, today, todayDay, opts)) streak++;
      else break;
      start = addDaysIso(start, -7);
    }
    return streak;
  }
  let streak = 0;
  let iso = today;
  let skippedPendingToday = false;
  for (let i = 0; i < 365; i++) {
    if (!habitDueOn(h, iso)) {
      iso = addDaysIso(iso, -1);
      continue;
    }
    if (completedOn(h, iso, today, todayDay, opts)) {
      streak++;
    } else if (iso === today && !skippedPendingToday) {
      // today isn't checked yet — the streak holds until the day is over
      skippedPendingToday = true;
    } else {
      break;
    }
    iso = addDaysIso(iso, -1);
  }
  return streak;
}

export function longestStreak(
  h: Habit,
  today: string,
  todayDay: DailyMetrics | null,
  opts?: HabitOpts
): number {
  if (h.frequency === "CUSTOM") {
    let best = 0;
    let run = 0;
    let ws = weekStartOf(today);
    for (let i = 0; i < 104; i++) {
      if (weeklyCompleted(h, ws, today, todayDay, opts)) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
      ws = addDaysIso(ws, -7);
    }
    return best;
  }
  let best = 0;
  let run = 0;
  let iso = today;
  for (let i = 0; i < 400; i++) {
    if (!habitDueOn(h, iso)) {
      iso = addDaysIso(iso, -1);
      continue;
    }
    if (completedOn(h, iso, today, todayDay, opts)) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
    iso = addDaysIso(iso, -1);
  }
  return best;
}

/** Completion rate over the trailing `windowDays` (daily/weekdays) or weeks (custom). */
export function completionRate(
  h: Habit,
  today: string,
  todayDay: DailyMetrics | null,
  windowDays = 28,
  opts?: HabitOpts
): number {
  if (h.frequency === "CUSTOM") {
    const weeks = Math.max(1, Math.ceil(windowDays / 7));
    let done = 0;
    let ws = addDaysIso(weekStartOf(today), -(weeks - 1) * 7);
    for (let i = 0; i < weeks; i++) {
      if (weeklyCompleted(h, ws, today, todayDay, opts)) done++;
      ws = addDaysIso(ws, 7);
    }
    return Math.round((done / weeks) * 100);
  }
  let due = 0;
  let done = 0;
  for (let i = windowDays - 1; i >= 0; i--) {
    const iso = addDaysIso(today, -i);
    if (!habitDueOn(h, iso)) continue;
    due++;
    if (completedOn(h, iso, today, todayDay, opts)) done++;
  }
  return due === 0 ? 0 : Math.round((done / due) * 100);
}

/** Human label for a habit's target, e.g. "≥ 8h", "× 3 / week". */
export function targetLabel(h: Habit): string {
  if (h.targetType === "BOOLEAN") {
    return h.frequency === "CUSTOM" ? `×${h.timesPerWeek}/wk` : "Daily";
  }
  const unit = h.unit ? ` ${h.unit}` : "";
  return `${h.autoOp === "lte" ? "≤" : "≥"} ${h.targetValue}${unit}`;
}
