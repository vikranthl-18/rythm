// ---------------------------------------------------------------------------
// Cross-correlation insights — \"what the data says\". The AI coach already
// answers questions; this engine finds the surprising PATTERNS the user never
// asked about, deterministically, from the days + workouts we have. Each
// insight only appears when there are enough real data points to say it.
// ---------------------------------------------------------------------------

import type { DailyMetrics, Workout } from "../types";

export interface DataInsight {
  icon: string;
  title: string;
  body: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function nextDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function computeDataInsights(days: DailyMetrics[], workouts: Workout[]): DataInsight[] {
  const out: DataInsight[] = [];
  if (days.length < 4) return out;
  const byDate = new Map(days.map((d) => [d.date, d]));

  // 1) Evening training → same-night sleep. A workout ending after 20:00 is
  //    expected to push sleep later; quantify the actual cost in sleep score.
  {
    const evening: number[] = [];
    const other: number[] = [];
    for (const w of workouts) {
      const day = byDate.get(w.startIso.slice(0, 10));
      if (!day || !day.sleep.durationMin) continue;
      const hour = new Date(w.endIso).getHours();
      (hour >= 20 ? evening : other).push(day.sleep.score);
    }
    if (evening.length >= 2 && other.length >= 2) {
      const e = avg(evening);
      const o = avg(other);
      if (Math.abs(e - o) >= 5) {
        out.push({
          icon: "🌙",
          title: e < o ? "Evening sessions cost you sleep" : "Evening sessions don't hurt your sleep",
          body:
            e < o
              ? `Nights after a workout ending after 8pm score ${Math.round(e)}/100 vs ${Math.round(o)} after earlier sessions — a ${Math.round(o - e)}-point gap. Moving hard sessions earlier would pay off.`
              : `You sleep ${Math.round(e)}/100 after evening sessions — even slightly better than the ${Math.round(o)} you score otherwise. You're a natural night trainer.`,
        });
      }
    }
  }

  // 2) High-strain day → that night's sleep.
  {
    const hard: number[] = [];
    const easy: number[] = [];
    for (const d of days) {
      if (!d.sleep.durationMin) continue;
      (d.strain >= 12 ? hard : d.strain < 6 ? easy : null)?.push(d.sleep.score);
    }
    if (hard.length >= 2 && easy.length >= 2) {
      const h = avg(hard);
      const e = avg(easy);
      if (h < e - 4) {
        out.push({
          icon: "🔥",
          title: "Big training days shorten your sleep",
          body: `After days with strain ≥ 12 you sleep ${Math.round(h)}/100 vs ${Math.round(e)} after easy days. The body needs the extra rest it's missing — a slightly earlier bedtime on hard days would close the gap.`,
        });
      }
    }
  }

  // 3) Short sleep → next-day resting HR. A sleeping HR that was suppressed
  //    by a bad night usually shows up as a higher resting HR the next day.
  {
    const afterShort: number[] = [];
    const afterOk: number[] = [];
    for (const d of days) {
      const next = byDate.get(nextDate(d.date));
      if (!next || next.restingHR <= 0) continue;
      (d.sleep.durationMin > 0 && d.sleep.durationMin < 360 ? afterShort : afterOk).push(next.restingHR);
    }
    if (afterShort.length >= 2 && afterOk.length >= 2) {
      const s = avg(afterShort);
      const o = avg(afterOk);
      if (s > o + 1.5) {
        out.push({
          icon: "🫀",
          title: "Short nights raise your resting HR",
          body: `After nights under 6h your resting HR averages ${Math.round(s)} bpm vs ${Math.round(o)} after normal nights — a ${Math.round(s - o)} bpm bump that shows exactly how much sleep drives your recovery.`,
        });
      }
    }
  }

  // 4) Training streaks → next-day recovery. Three+ consecutive training days
  //    should drop recovery; compare vs days after 0-1 training days.
  {
    const trainDays = new Set(workouts.map((w) => w.startIso.slice(0, 10)));
    const afterStreak: number[] = [];
    const afterLight: number[] = [];
    for (const d of days) {
      const next = byDate.get(nextDate(d.date));
      if (!next || next.recovery <= 0) continue;
      const streak =
        trainDays.has(d.date) &&
        trainDays.has(nextDate(addDaysIsoLocal(d.date, -1))) &&
        trainDays.has(addDaysIsoLocal(d.date, -2));
      (streak ? afterStreak : afterLight).push(next.recovery);
    }
    if (afterStreak.length >= 2 && afterLight.length >= 2) {
      const s = avg(afterStreak);
      const o = avg(afterLight);
      if (s < o - 8) {
        out.push({
          icon: "📅",
          title: "Three days on, one day off",
          body: `After 3+ consecutive training days your next-day recovery drops to ${Math.round(s)}% vs ${Math.round(o)}% after lighter days. A scheduled rest day at the end of each streak would keep you fresher.`,
        });
      }
    }
  }

  return out;
}

function addDaysIsoLocal(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
