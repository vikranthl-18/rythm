// ---------------------------------------------------------------------------
// Race mode — reverse periodization. Pick a race (distance + date) and rythm
// builds the plan backwards: base → build → peak → taper → race, with weekly
// strain targets and key sessions, computed from the user's actual long-run
// baseline. `planSessionForDate` maps today onto the plan and
// `recoveryAdjustedSession` rescales it by today's recovery — the plan adapts
// live, which is the whole point.
// ---------------------------------------------------------------------------

import type { RaceConfig } from "../types";

export type { RaceConfig } from "../types";

export interface PlanSession {
  dayLabel: string; // "Mon"
  title: string;
  desc: string;
  durationMin: number;
  strain: number;
  longRunKm?: number;
}

export type PlanPhase = "base" | "build" | "peak" | "taper" | "race";

export interface PlanWeek {
  startIso: string;
  phase: PlanPhase;
  phaseLabel: string;
  strainTarget: number;
  longRunKm: number | null;
  sessions: PlanSession[];
}

export interface RacePlan {
  race: RaceConfig;
  weeks: PlanWeek[];
  totalWeeks: number;
  countdownDays: number;
  todayIso: string;
}

export const RACE_DISTANCES: { km: number; label: string; icon: string }[] = [
  { km: 5, label: "5K", icon: "⚡" },
  { km: 10, label: "10K", icon: "🏃" },
  { km: 21.0975, label: "Half marathon", icon: "🏅" },
  { km: 42.195, label: "Marathon", icon: "🎽" },
];

export function raceDistanceLabel(km: number): string {
  const found = RACE_DISTANCES.find((r) => Math.abs(r.km - km) < 0.01);
  return found ? found.label : `${km} km`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayOf = (iso: string) => new Date(iso + "T00:00:00").getDay();

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysUntil(raceDateIso: string, todayIso: string): number {
  const a = new Date(raceDateIso + "T00:00:00").getTime();
  const b = new Date(todayIso + "T00:00:00").getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}

interface SessionSpec {
  dayLabel: string;
  title: string;
  desc: string;
  durationMin: number;
  strain: number;
  longRunKm?: number;
}

/**
 * A week's skeleton keyed by weekday (0=Sun..6=Sat). Long-run distance is
 * injected per week so it can progress.
 */
function weekSessions(longRunKm: number, raceKm: number): SessionSpec[] {
  const easy = (min: number): SessionSpec => ({
    dayLabel: "Mon",
    title: "Easy run",
    desc: `Zone 2 conversational pace, ${min} min.`,
    durationMin: min,
    strain: Math.round(min / 12),
  });
  const intervals = (): SessionSpec => ({
    dayLabel: "Tue",
    title: "Intervals",
    desc:
      raceKm <= 10
        ? "6 × 800 m at goal pace with 2 min jog recovery."
        : "5 × 1 km at goal pace with 2 min jog recovery.",
    durationMin: 40,
    strain: 10,
  });
  const tempo = (): SessionSpec => ({
    dayLabel: "Thu",
    title: "Tempo",
    desc: "2 km easy + 20 min at threshold + 2 km easy.",
    durationMin: 45,
    strain: 9,
  });
  const long = (): SessionSpec => ({
    dayLabel: "Sat",
    title: "Long run",
    desc: `Steady, comfortable pace — ${longRunKm.toFixed(1)} km.`,
    durationMin: Math.round(longRunKm * 6.2),
    strain: Math.round(4 + longRunKm * 0.9),
    longRunKm,
  });
  const cross = (): SessionSpec => ({
    dayLabel: "Wed",
    title: "Cross / mobility",
    desc: "20–30 min easy bike, swim or strength + stretching.",
    durationMin: 25,
    strain: 2,
  });
  return [easy(35), intervals(), cross(), tempo(), easy(30), long(), easy(25)];
}

const PHASE_LABEL: Record<PlanPhase, string> = {
  base: "Base building",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race: "Race week",
};

export function buildRacePlan(input: {
  race: RaceConfig;
  todayIso: string;
  currentLongRunKm?: number;
}): RacePlan {
  const { race, todayIso } = input;
  const countdown = daysUntil(race.dateIso, todayIso);
  const totalWeeks = Math.max(4, Math.min(16, Math.ceil(countdown / 7) || 4));
  const currentLong = Math.max(2, Math.round((input.currentLongRunKm ?? Math.max(4, race.distanceKm * 0.3)) * 10) / 10);

  // Taper = final 2 full weeks before race week; race week = the last week.
  const taperCount = totalWeeks >= 6 ? 2 : 1;
  const raceWeekIdx = totalWeeks - 1;
  const taperStartIdx = raceWeekIdx - taperCount;

  // Phase boundaries (indexes into weeks[]).
  const pre = taperStartIdx; // weeks before taper get base/build/peak
  const baseEnd = Math.max(1, Math.round(pre * 0.45));
  const buildEnd = Math.max(baseEnd + 1, Math.round(pre * 0.75));

  // Long-run progression: ramp from current → peak, then taper.
  const peakLong = Math.round(Math.min(race.distanceKm * (race.distanceKm <= 10 ? 0.8 : 0.75), Math.max(10, race.distanceKm * 0.7)) * 10) / 10;
  const weeks: PlanWeek[] = [];
  // This week's Monday (weekday 1..6 → back to Monday; Sunday → back 6 days).
  let startIso = addDays(todayIso, -((weekdayOf(todayIso) + 6) % 7));

  for (let i = 0; i < totalWeeks; i++) {
    let phase: PlanPhase;
    let phaseLabel: string;
    let strainTarget: number;
    let longRunKm: number | null;
    if (i === raceWeekIdx) {
      phase = "race";
      phaseLabel = PHASE_LABEL.race;
      strainTarget = 12;
      longRunKm = null;
    } else if (i >= taperStartIdx) {
      phase = "taper";
      phaseLabel = PHASE_LABEL.taper;
      strainTarget = 20;
      longRunKm = Math.round(peakLong * (i === taperStartIdx ? 0.55 : 0.35));
    } else if (i < baseEnd) {
      phase = "base";
      phaseLabel = PHASE_LABEL.base;
      strainTarget = 34;
      longRunKm = null;
    } else if (i < buildEnd) {
      phase = "build";
      phaseLabel = PHASE_LABEL.build;
      strainTarget = 48;
      longRunKm = null;
    } else {
      phase = "peak";
      phaseLabel = PHASE_LABEL.peak;
      strainTarget = 58;
      longRunKm = null;
    }

    // Long-run distance for base/build/peak ramps week over week.
    if (phase === "base" || phase === "build" || phase === "peak") {
      const weeksInPhase = i - (phase === "base" ? 0 : baseEnd) + 1;
      const ramp =
        phase === "base"
          ? currentLong * (1 + 0.1 * (i + 1))
          : currentLong * (1 + 0.1 * baseEnd) + (phase === "build" ? 0.9 : 1.6) * weeksInPhase;
      longRunKm = Math.round(Math.min(ramp, peakLong) * 10) / 10;
    }

    const specs = weekSessions(longRunKm ?? peakLong * 0.5, race.distanceKm);
    const sessions = specs.map((sp) => ({
      dayLabel: sp.dayLabel,
      title: sp.title,
      desc: sp.desc,
      durationMin: sp.durationMin,
      strain: sp.strain,
      ...(sp.longRunKm !== undefined ? { longRunKm: sp.longRunKm } : {}),
    }));
    if (phase === "taper") {
      // Taper weeks drop to easy runs + short strides.
      sessions.length = 0;
      sessions.push(
        { dayLabel: "Mon", title: "Easy run", desc: "30 min zone 2.", durationMin: 30, strain: 3 },
        { dayLabel: "Wed", title: "Strides", desc: "4 × 20 s fast, full recovery.", durationMin: 25, strain: 3 },
        { dayLabel: "Sat", title: "Long run", desc: `${longRunKm?.toFixed(1)} km at easy pace.`, durationMin: Math.round((longRunKm ?? 5) * 6.2), strain: Math.round(3 + (longRunKm ?? 5) * 0.6), longRunKm: longRunKm ?? 5 },
      );
    }
    if (phase === "race") {
      sessions.length = 0;
      sessions.push(
        { dayLabel: "Mon", title: "Easy run", desc: "20 min very easy.", durationMin: 20, strain: 2 },
        { dayLabel: "Thu", title: "Shakeout", desc: "15 min easy + 4 strides.", durationMin: 15, strain: 2 },
        { dayLabel: DAY_LABELS[weekdayOf(race.dateIso)], title: "🏁 Race day", desc: `${raceDistanceLabel(race.distanceKm)} — ${race.targetPaceSecPerKm ? `goal pace ${Math.floor(race.targetPaceSecPerKm / 60)}:${String(Math.round(race.targetPaceSecPerKm % 60)).padStart(2, "0")}/km` : "race your plan"}.`, durationMin: Math.round(race.distanceKm * 3.8), strain: 10, longRunKm: race.distanceKm },
      );
    }

    weeks.push({ startIso, phase, phaseLabel, strainTarget, longRunKm, sessions });
    startIso = addDays(startIso, 7);
  }

  return { race, weeks, totalWeeks, countdownDays: countdown, todayIso };
}

/** The session scheduled on a given date (matches weekday), or null (rest day). */
export function planSessionForDate(plan: RacePlan, iso: string): PlanSession | null {
  const wd = weekdayOf(iso);
  const weekIdx = Math.floor(daysUntil(iso, plan.weeks[0].startIso) / 7);
  const week = plan.weeks[Math.max(0, Math.min(plan.weeks.length - 1, weekIdx))];
  return week.sessions.find((s) => s.dayLabel === DAY_LABELS[wd]) ?? null;
}

/** Current phase label for the countdown card. */
export function phaseNow(plan: RacePlan, todayIso: string): { phase: PlanPhase; label: string } {
  const weekIdx = Math.floor(daysUntil(todayIso, plan.weeks[0].startIso) / 7);
  const week = plan.weeks[Math.max(0, Math.min(plan.weeks.length - 1, weekIdx))];
  return { phase: week.phase, label: week.phaseLabel };
}

export interface AdjustedSession {
  title: string;
  desc: string;
  tone: "good" | "warn" | "bad" | "accent";
  swapped: boolean;
}

/** Rescale today's planned session by recovery (Whoop-style: red = rest). */
export function recoveryAdjustedSession(
  session: PlanSession | null,
  recovery: number
): AdjustedSession {
  const isQuality = session && (session.title === "Intervals" || session.title === "Tempo" || session.title.includes("🏁"));
  if (recovery < 34) {
    return {
      title: "Recovery day",
      desc: `Recovery is ${recovery}% — red. Even the plan bends: swap today's session for 20–30 min zone 1 or rest. Sleep is the session.`,
      tone: "bad",
      swapped: true,
    };
  }
  if (recovery < 55 && isQuality) {
    return {
      title: "Easy version",
      desc: `Recovery is ${recovery}% — yellow. Keep the session but drop the intensity: ${session?.title.toLowerCase()} → easy zone 2, same time or less.`,
      tone: "warn",
      swapped: true,
    };
  }
  if (!session) {
    return { title: "Rest day", desc: "The plan says rest. Active recovery: a walk, mobility or easy 20 min.", tone: "accent", swapped: false };
  }
  return {
    title: session.title,
    desc: session.desc,
    tone: "good",
    swapped: false,
  };
}
