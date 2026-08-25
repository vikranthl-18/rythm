import { describe, expect, it } from "vitest";
import {
  buildRacePlan,
  phaseNow,
  planSessionForDate,
  raceDistanceLabel,
  recoveryAdjustedSession,
} from "../periodize";

const base = {
  race: { distanceKm: 21.0975, dateIso: "2026-11-01", targetPaceSecPerKm: 300 },
  todayIso: "2026-08-10", // ~12 weeks out
  currentLongRunKm: 8,
};

describe("buildRacePlan", () => {
  it("builds a plan backward with the right number of weeks", () => {
    const plan = buildRacePlan(base);
    expect(plan.totalWeeks).toBeGreaterThanOrEqual(8);
    expect(plan.totalWeeks).toBeLessThanOrEqual(16);
    expect(plan.weeks).toHaveLength(plan.totalWeeks);
    expect(plan.countdownDays).toBeGreaterThan(0);
    expect(plan.weeks[0].startIso).toBe("2026-08-10"); // Monday of this week
  });

  it("places taper before race week and drops the long run", () => {
    const plan = buildRacePlan(base);
    const raceWeek = plan.weeks[plan.weeks.length - 1];
    const taperWeek = plan.weeks[plan.weeks.length - 2];
    expect(raceWeek.phase).toBe("race");
    expect(taperWeek.phase).toBe("taper");
    expect(taperWeek.longRunKm ?? 99).toBeLessThan(plan.weeks[plan.weeks.length - 3].longRunKm ?? 0);
    expect(raceWeek.sessions.some((s) => s.title.includes("Race day"))).toBe(true);
  });

  it("ramps the long run up to a peak then tapers", () => {
    const plan = buildRacePlan(base);
    const longs = plan.weeks
      .filter((w) => w.longRunKm !== null)
      .map((w) => w.longRunKm as number);
    const peak = Math.max(...longs);
    const peakIdx = longs.indexOf(peak);
    // long runs grow to a peak
    for (let i = 1; i <= peakIdx; i++) expect(longs[i]).toBeGreaterThanOrEqual(longs[i - 1]);
    // taper cuts it way down
    expect(longs[longs.length - 1]).toBeLessThan(peak * 0.6);
  });

  it("schedules the race-day session on the race date's weekday", () => {
    const plan = buildRacePlan({ ...base, race: { ...base.race, dateIso: "2026-11-01" } });
    // Nov 1 2026 is a Sunday
    expect(planSessionForDate(plan, "2026-11-01")?.title).toContain("Race day");
    expect(planSessionForDate(plan, "2026-11-02")?.title).toBe("Easy run");
  });
});

describe("phaseNow", () => {
  it("starts in base and ends in race week", () => {
    const plan = buildRacePlan(base);
    expect(phaseNow(plan, base.todayIso).phase).toBe("base");
    expect(phaseNow(plan, base.race.dateIso).phase).toBe("race");
  });
});

describe("recoveryAdjustedSession", () => {
  const plan = buildRacePlan(base);
  const tempo = planSessionForDate(plan, "2026-08-13"); // Thu → Tempo

  it("forces a recovery day when recovery is red", () => {
    const adj = recoveryAdjustedSession(tempo, 30);
    expect(adj.title).toContain("Recovery");
    expect(adj.swapped).toBe(true);
    expect(adj.tone).toBe("bad");
  });

  it("downgrades quality sessions in the yellow zone", () => {
    const adj = recoveryAdjustedSession(tempo, 45);
    expect(adj.swapped).toBe(true);
    expect(adj.title).toContain("Easy version");
  });

  it("keeps the plan when recovery is good", () => {
    const adj = recoveryAdjustedSession(tempo, 80);
    expect(adj.swapped).toBe(false);
    expect(adj.title).toBe(tempo!.title);
  });

  it("says rest day when nothing is scheduled", () => {
    const adj = recoveryAdjustedSession(null, 80);
    expect(adj.title).toBe("Rest day");
  });
});

describe("raceDistanceLabel", () => {
  it("labels known distances", () => {
    expect(raceDistanceLabel(21.0975)).toBe("Half marathon");
    expect(raceDistanceLabel(5)).toBe("5K");
    expect(raceDistanceLabel(17)).toBe("17 km");
  });
});
