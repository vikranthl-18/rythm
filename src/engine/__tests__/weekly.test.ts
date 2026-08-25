import { describe, expect, it } from "vitest";
import { weeklyComparison } from "../weekly";
import type { DailyMetrics, Habit, Workout } from "../../types";

function wo(id: string, iso: string, distM: number, sec: number): Workout {
  return {
    id,
    type: "run",
    title: id,
    startIso: iso + "T08:00:00Z",
    endIso: iso + "T08:30:00Z",
    durationSec: sec,
    distanceM: distM,
    elevationGainM: 10,
    avgHr: 150,
    maxHr: 170,
    strain: 10,
    zones: { z1: 5, z2: 10, z3: 5, z4: 2, z5: 0 },
    splitsSec: [],
    route: [],
  };
}

function habit(logs: Record<string, number>): Habit {
  return {
    id: "h1",
    title: "Drink water",
    icon: "💧",
    color: "#73976a",
    targetType: "BOOLEAN",
    targetValue: 1,
    unit: "",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 0,
    autoMetric: null,
    autoOp: null,
    logs,
    createdAt: "2026-01-01",
  };
}

const day: DailyMetrics = {
  date: "2026-08-10",
  measuredAtMin: 360,
  hrv: 60,
  restingHR: 55,
  skinTemp: 36.4,
  spo2: 97,
  respRate: 14,
  steps: 8000,
  activeEnergy: 400,
  calories: 2000,
  activeZoneMin: 30,
  sleep: { date: "2026-08-10", durationMin: 450, deepMin: 90, lightMin: 220, remMin: 110, awakeMin: 30, needMin: 460, score: 80 },
  recovery: 70,
  strain: 10,
};

describe("weeklyComparison", () => {
  it("detects when this week is ahead on sessions", () => {
    const res = weeklyComparison({
      workouts: [
        wo("a", "2026-08-10", 5000, 1800),
        wo("b", "2026-08-09", 5000, 1800),
        wo("c", "2026-08-03", 5000, 1800), // last week
      ],
      habits: [],
      days: [day],
      todayIso: "2026-08-10",
    });
    expect(res.sessionsDelta).toBe(1);
    expect(res.ahead).toBe(true);
    expect(res.headline).toContain("1 session ahead");
  });

  it("counts habit consistency in the window", () => {
    const res = weeklyComparison({
      workouts: [],
      habits: [
        habit({ "2026-08-10": 1, "2026-08-09": 1 }),
        habit({ "2026-08-08": 1 }),
      ],
      days: [day],
      todayIso: "2026-08-10",
    });
    // 2 habits × 7 days due each = 14 due; 3 done
    expect(res.thisWeek.habitsDue).toBe(14);
    expect(res.thisWeek.habitsDone).toBe(3);
    expect(res.consistencyPct).toBe(Math.round((3 / 14) * 100));
  });

  it("computes the training streak from consecutive workout days", () => {
    const res = weeklyComparison({
      workouts: [
        wo("a", "2026-08-10", 5000, 1800),
        wo("b", "2026-08-09", 5000, 1800),
        wo("c", "2026-08-08", 5000, 1800),
        wo("d", "2026-08-02", 5000, 1800),
      ],
      habits: [],
      days: [day],
      todayIso: "2026-08-10",
    });
    expect(res.streak.current).toBe(3);
    expect(res.streak.longest).toBe(3);
    expect(res.headline).toContain("personal best");
  });

  it("points at the streak target when not at the longest", () => {
    const res = weeklyComparison({
      workouts: [
        wo("a", "2026-08-10", 5000, 1800),
        wo("b", "2026-08-09", 5000, 1800),
        wo("c", "2026-08-06", 5000, 1800),
        wo("d", "2026-08-05", 5000, 1800),
        wo("e", "2026-08-04", 5000, 1800),
        wo("f", "2026-08-03", 5000, 1800),
      ],
      habits: [],
      days: [day],
      todayIso: "2026-08-10",
    });
    expect(res.streak.current).toBe(2);
    expect(res.streak.longest).toBe(4);
    expect(res.headline).toContain("2 days from your longest training streak");
  });
});
