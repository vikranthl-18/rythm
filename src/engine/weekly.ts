// ---------------------------------------------------------------------------
// "Beat last week" — a rolling 7-day comparison against the previous 7 days
// (workouts, distance, time, habit consistency) plus training-streak math.
// Pure + deterministic so it's testable; the dashboard renders the headline.
// ---------------------------------------------------------------------------

import type { DailyMetrics, Habit, Workout } from "../types";
import { habitDueOn } from "./habits";
import { addDaysIso } from "../lib/rng";

export interface WeekTotals {
  km: number;
  sessions: number;
  sec: number;
  habitsDue: number;
  habitsDone: number;
}

export interface TrainingStreak {
  current: number;
  longest: number;
}

export interface WeeklyComparison {
  thisWeek: WeekTotals;
  lastWeek: WeekTotals;
  kmDelta: number;
  sessionsDelta: number;
  secDelta: number;
  habitsDelta: number;
  consistencyPct: number; // habits done / due this week
  streak: TrainingStreak;
  ahead: boolean; // beating last week overall
  headline: string;
}

function windowTotals(
  workouts: Workout[],
  habits: Habit[],
  days: DailyMetrics[],
  endIso: string,
  startIso: string
): WeekTotals {
  const t: WeekTotals = { km: 0, sessions: 0, sec: 0, habitsDue: 0, habitsDone: 0 };
  for (const w of workouts) {
    const d = w.startIso.slice(0, 10);
    if (d >= startIso && d <= endIso) {
      t.km += w.distanceM;
      t.sessions++;
      t.sec += w.durationSec;
    }
  }
  for (const h of habits) {
    for (let i = 0; i < 7; i++) {
      const iso = addDaysIso(endIso, -i);
      if (iso < startIso) break;
      if (habitDueOn(h, iso)) {
        t.habitsDue++;
        if (h.logs[iso] !== undefined) t.habitsDone++;
      }
    }
  }
  void days;
  return t;
}

function trainingStreak(workouts: Workout[], todayIso: string): TrainingStreak {
  const days = new Set(workouts.map((w) => w.startIso.slice(0, 10)));
  let current = 0;
  let cursor = todayIso;
  while (days.has(cursor)) {
    current++;
    cursor = addDaysIso(cursor, -1);
  }
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...days].sort()) {
    if (prev !== null && addDaysIso(prev, 1) === d) run++;
    else run = 1;
    if (run > longest) longest = run;
    prev = d;
  }
  return { current, longest };
}

export function weeklyComparison(input: {
  workouts: Workout[];
  habits: Habit[];
  days: DailyMetrics[];
  todayIso: string;
}): WeeklyComparison {
  const { workouts, habits, days, todayIso } = input;
  const lastWeekEnd = addDaysIso(todayIso, -7);
  const thisWeek = windowTotals(workouts, habits, days, todayIso, addDaysIso(todayIso, -6));
  const lastWeek = windowTotals(workouts, habits, days, lastWeekEnd, addDaysIso(lastWeekEnd, -6));
  const streak = trainingStreak(workouts, todayIso);
  const kmDelta = Math.round(thisWeek.km - lastWeek.km);
  const sessionsDelta = thisWeek.sessions - lastWeek.sessions;
  const secDelta = thisWeek.sec - lastWeek.sec;
  const habitsDelta = thisWeek.habitsDone - lastWeek.habitsDone;
  const consistencyPct =
    thisWeek.habitsDue > 0 ? Math.round((thisWeek.habitsDone / thisWeek.habitsDue) * 100) : 100;
  const ahead = sessionsDelta > 0 || (sessionsDelta === 0 && kmDelta > 0);

  let headline: string;
  if (sessionsDelta > 0) {
    headline = `You're ${sessionsDelta} session${sessionsDelta === 1 ? "" : "s"} ahead of last week.`;
  } else if (sessionsDelta < 0) {
    headline = `Last week had ${Math.abs(sessionsDelta)} more session${sessionsDelta === -1 ? "" : "s"} than this one.`;
  } else if (kmDelta > 0) {
    headline = `Same session count — but ${(kmDelta / 1000).toFixed(1)} km ahead on distance.`;
  } else if (kmDelta < 0) {
    headline = `Same session count, ${(Math.abs(kmDelta) / 1000).toFixed(1)} km behind on distance.`;
  } else {
    headline = "Right on last week's pace — even stevens.";
  }

  if (streak.longest > 0 && streak.current < streak.longest) {
    headline += ` ${streak.longest - streak.current} day${streak.longest - streak.current === 1 ? "" : "s"} from your longest training streak.`;
  } else if (streak.current >= 3 && streak.current === streak.longest) {
    headline += ` ${streak.current}-day streak — a personal best.`;
  } else if (streak.current > 0) {
    headline += ` ${streak.current}-day training streak.`;
  }

  return {
    thisWeek,
    lastWeek,
    kmDelta,
    sessionsDelta,
    secDelta,
    habitsDelta,
    consistencyPct,
    streak,
    ahead,
    headline,
  };
}
