import { describe, expect, it } from "vitest";
import { computeRythmScore, rythmColor } from "../rhythm";
import { computeLoadBalance, recommendSession } from "../load";
import { computeReadiness } from "../readiness";
import { computeGoalProgress, matchGoal } from "../goals";
import { userBaseline } from "../baselines";
import type { DailyMetrics, Workout } from "../../types";

const baseInput = {
  recovery: 80,
  sleepScore: 84,
  strainNow: 6,
  strainTarget: 14.5,
  acwr: 1.1,
  loadStatus: "Balanced",
  steps: 8000,
  stepsGoal: 8000,
  zoneMinutes: 160,
  zoneMinGoal: 150,
  habitToday: 5,
  habitDue: 5,
  habitWeekPct: 90,
  sessionsDays: 10,
};

function strainDays(count: number, strain: number): DailyMetrics[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    measuredAtMin: 360,
    recovery: 60,
    strain,
    hrv: 60,
    restingHR: 55,
    steps: 7000,
    calories: 2200,
    activeEnergy: 300,
    activeZoneMin: 60,
    skinTemp: 36.1,
    spo2: 98,
    respRate: 14,
    sleep: { date: "2026-08-01", durationMin: 480, deepMin: 100, remMin: 100, lightMin: 250, awakeMin: 30, needMin: 480, score: 80 },
  }));
}

describe("Rythm Score", () => {
  it("scores a balanced, healthy profile in the green", () => {
    const r = computeRythmScore(baseInput);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.color).toBe("green");
  });

  it("drops the score when the pillars are weak", () => {
    const bad = computeRythmScore({
      ...baseInput,
      recovery: 20,
      sleepScore: 30,
      strainNow: 18,
      strainTarget: 4,
      acwr: 1.8,
      loadStatus: "Overloading",
      steps: 2000,
      zoneMinutes: 20,
      habitToday: 1,
      habitWeekPct: 30,
      sessionsDays: 2,
    });
    expect(bad.score).toBeLessThan(40);
    expect(bad.color).toBe("red");
  });

  it("gives every pillar a reason and an improvement tip", () => {
    const r = computeRythmScore(baseInput);
    expect(r.parts).toHaveLength(6);
    const weights = r.parts.reduce((a, p) => a + p.weight, 0);
    expect(weights).toBeCloseTo(1, 5);
    for (const p of r.parts) {
      expect(p.reason.length).toBeGreaterThan(20);
      expect(p.improve.length).toBeGreaterThan(10);
    }
  });

  it("maps score bands to colors", () => {
    expect(rythmColor(80)).toBe("green");
    expect(rythmColor(50)).toBe("yellow");
    expect(rythmColor(20)).toBe("red");
  });
});

describe("load balance", () => {
  it("computes acute and chronic load from the user's strain history", () => {
    const load = computeLoadBalance(strainDays(28, 12));
    expect(load.acute).toBeCloseTo(12, 1);
    expect(load.chronic).toBeCloseTo(12, 1);
    expect(load.acwr).toBeCloseTo(1, 2);
    expect(load.status).toBe("Balanced");
    expect(load.learned).toBe(true);
  });

  it("flags overloading when acute >> chronic", () => {
    const days = [...strainDays(21, 4), ...strainDays(7, 60)];
    const load = computeLoadBalance(days); // 21 easy + 7 hard
    expect(load.acwr).toBeGreaterThan(1.5);
    expect(load.status).toBe("Overloading");
  });

  it("recommends a build session when underloaded and recovered", () => {
    const rec = recommendSession(80, { acute: 4, chronic: 8, acwr: 0.5, status: "Underloading", chronicDays: 28, learned: true });
    expect(rec.title).toBe("Build session");
  });

  it("recommends recovery when recovery is red", () => {
    const rec = recommendSession(25, { acute: 12, chronic: 10, acwr: 1.2, status: "Balanced", chronicDays: 28, learned: true });
    expect(rec.title).toBe("Recovery session");
  });
});

describe("readiness", () => {
  it("blends recovery, sleep and freshness", () => {
    const r = computeReadiness({ recovery: 85, sleepScore: 80, strainNow: 2, strainTarget: 14.5 });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.status).toBe("Ready");
    expect(r.verdict.length).toBeGreaterThan(20);
  });

  it("reads low when everything is down", () => {
    const r = computeReadiness({ recovery: 25, sleepScore: 35, strainNow: 12, strainTarget: 5 });
    expect(r.status).toBe("Low");
  });
});

describe("goals", () => {
  const run = (km: number, mins: number, id: string): Workout => ({
    id,
    type: "run",
    title: `Run ${km}km`,
    startIso: "2026-08-01T08:00:00.000Z",
    endIso: "2026-08-01T09:00:00.000Z",
    durationSec: mins * 60,
    distanceM: km * 1000,
    elevationGainM: 20,
    avgHr: 150,
    maxHr: 175,
    strain: 8,
    zones: { z1: 5, z2: 10, z3: 20, z4: 10, z5: 5 },
    splitsSec: [300, 300],
    route: [],
  });

  it("matches free-text goals", () => {
    expect(matchGoal("Sub-20 min 5k")?.id).toBe("sub20-5k");
    expect(matchGoal("I want to run a half marathon")?.id).toBe("half-marathon");
    expect(matchGoal("first marathon in fall")?.id).toBe("marathon");
    expect(matchGoal("century ride")?.id).toBe("century");
    expect(matchGoal("100K month")?.id).toBe("month-100k");
  });

  it("computes half-marathon progress from the longest run", () => {
    const p = computeGoalProgress("half-marathon", {
      workouts: [run(7, 40, "a"), run(5, 30, "b")],
      todayIso: "2026-08-10",
    });
    expect(p).not.toBeNull();
    expect(p!.pct).toBeGreaterThan(30);
    expect(p!.pct).toBeLessThan(40);
    expect(p!.done.length).toBeGreaterThan(0);
    expect(p!.todo.length).toBeGreaterThan(0);
  });

  it("computes 5K progress from the best recorded 5K", () => {
    const fast = run(6.1, 30, "fast"); // ~4:55/km, covers 5K
    fast.route = [
      { lat: 37, lng: -122, t: 0, alt: 0, hr: 170 },
      { lat: 37.015, lng: -122, t: 590, alt: 0, hr: 170 },
      { lat: 37.03, lng: -122, t: 1180, alt: 0, hr: 170 },
    ];
    const p = computeGoalProgress("sub20-5k", { workouts: [fast], todayIso: "2026-08-10" });
    expect(p).not.toBeNull();
    expect(p!.pct).toBeLessThan(100);
  });
});

describe("baselines", () => {
  it("learns from the user's own history and reports the learning phase", () => {
    const few = strainDays(3, 60);
    const bFew = userBaseline(few, (d) => d.hrv);
    expect(bFew.learned).toBe(false);
    expect(bFew.daysToLearn).toBe(4);

    const many = strainDays(14, 60);
    const bMany = userBaseline(many, (d) => d.hrv);
    expect(bMany.learned).toBe(true);
    expect(bMany.value).toBeCloseTo(60, 5);
    expect(bMany.days).toBe(7); // uses the 7-day window
  });
});
