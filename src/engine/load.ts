// ---------------------------------------------------------------------------
// Training load & fitness balance
//  - Acute load  = average daily strain over the last 7 days  (what you're doing now)
//  - Chronic load = average daily strain over the last 28 days (what your body is used to)
//  - ACWR = acute ÷ chronic — the classic "fitness vs fatigue" balance ratio
// All computed from the user's own strain history.
// ---------------------------------------------------------------------------

import type { DailyMetrics } from "../types";

export type LoadStatus = "Underloading" | "Balanced" | "Spiking" | "Overloading";

export interface LoadBalance {
  acute: number; // 7-day avg strain
  chronic: number; // 28-day avg strain (falls back to available history)
  acwr: number;
  status: LoadStatus;
  chronicDays: number;
  learned: boolean; // true once 28 days (or all available history) are in
}

export function computeLoadBalance(days: DailyMetrics[]): LoadBalance {
  const acuteDays = days.slice(-7);
  const chronicDays = days.slice(-28);
  const avg = (arr: DailyMetrics[]) =>
    arr.length ? arr.reduce((a, d) => a + d.strain, 0) / arr.length : 0;

  const acute = avg(acuteDays);
  const chronic = avg(chronicDays);
  const acwr = chronic > 0.5 ? Math.round((acute / chronic) * 100) / 100 : 1;

  let status: LoadStatus;
  if (acwr < 0.8) status = "Underloading";
  else if (acwr <= 1.3) status = "Balanced";
  else if (acwr <= 1.5) status = "Spiking";
  else status = "Overloading";

  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    acwr,
    status,
    chronicDays: chronicDays.length,
    learned: days.length >= 28,
  };
}

export interface SessionRecommendation {
  title: string;
  body: string;
  tone: "good" | "warn" | "bad" | "accent";
}

/** Pick tomorrow's / today's session from recovery × load balance. */
export function recommendSession(recovery: number, load: LoadBalance): SessionRecommendation {
  const { acwr, status } = load;

  if (recovery < 34) {
    return {
      title: "Recovery session",
      body: `Recovery is ${recovery}% — red zone. Take a rest day or 20–30 min of zone 1 mobility/walk. Rebuilding now protects the next 7 days.`,
      tone: "bad",
    };
  }
  if (status === "Overloading" || status === "Spiking") {
    return {
      title: "Easy maintenance",
      body: `Your 7-day load is ${acwr.toFixed(2)}× your 28-day baseline (${status.toLowerCase()}). Fitness is growing, but fatigue is too — cap today at zone 1–2 so the balance can reset.`,
      tone: "warn",
    };
  }
  if (status === "Underloading" && recovery >= 67) {
    return {
      title: "Build session",
      body: `Load ratio ${acwr.toFixed(2)} is below 0.8 — your body is adapted and under-stimulated. With recovery at ${recovery}%, this is the ideal window to add a quality session (threshold or intervals).`,
      tone: "good",
    };
  }
  if (status === "Balanced" && recovery >= 67) {
    return {
      title: "Quality session",
      body: `Load is balanced (ratio ${acwr.toFixed(2)}) and recovery is ${recovery}% — the sweet spot. Go after your main quality session: tempo, threshold reps, or a strong long run.`,
      tone: "good",
    };
  }
  if (recovery >= 60) {
    return {
      title: "Steady aerobic",
      body: `Balanced-enough load with recovery at ${recovery}% — a steady zone 2 session (40–60 min) keeps the engine turning without adding fatigue.`,
      tone: "accent",
    };
  }
  return {
    title: "Easy day",
    body: `Recovery is ${recovery}% and load is ${status.toLowerCase()}. Keep it easy — zone 1–2 only — and prioritize sleep tonight.`,
    tone: "accent",
  };
}
