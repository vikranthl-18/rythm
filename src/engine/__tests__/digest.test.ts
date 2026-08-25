import { describe, expect, it } from "vitest";
import { buildDigestFallback } from "../digest";
import type { DailyMetrics, Habit, Workout } from "../../types";

function mkDay(date: string, recovery: number, sleepMin: number, sleepScore: number): DailyMetrics {
  return {
    date,
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
    sleep: { date, durationMin: sleepMin, deepMin: 90, lightMin: 220, remMin: 110, awakeMin: 30, needMin: 480, score: sleepScore },
    recovery,
    strain: 10,
  };
}

function mkWo(date: string, distM: number, type: "run" | "cycle" = "run"): Workout {
  return {
    id: date + type,
    type,
    title: `${(distM / 1000).toFixed(1)} km ${type}`,
    startIso: date + "T08:00:00Z",
    endIso: date + "T09:00:00Z",
    durationSec: 3600,
    distanceM: distM,
    elevationGainM: 10,
    avgHr: 150,
    maxHr: 170,
    strain: 12,
    zones: { z1: 5, z2: 10, z3: 5, z4: 2, z5: 0 },
    splitsSec: [],
    route: [],
  };
}

const days = [
  mkDay("2026-08-04", 40, 300, 40),
  mkDay("2026-08-05", 55, 350, 50),
  mkDay("2026-08-06", 60, 380, 60),
  mkDay("2026-08-07", 62, 400, 65),
  mkDay("2026-08-08", 70, 420, 72),
  mkDay("2026-08-09", 74, 440, 78),
  mkDay("2026-08-10", 78, 460, 82),
];

describe("buildDigestFallback", () => {
  it("produces exactly four paragraphs grounded in the data", () => {
    const d = buildDigestFallback({
      days,
      workouts: [mkWo("2026-08-09", 6000), mkWo("2026-08-07", 8000)],
      habits: [],
      todayIso: "2026-08-10",
      goal: "Sub-20 min 5K",
    });
    expect(d.paragraphs).toHaveLength(4);
    expect(d.ai).toBe(false);
    expect(d.paragraphs[0]).toContain("2 sessions");
    expect(d.paragraphs[0]).toContain("14.0 km");
    expect(d.paragraphs[1]).toContain("recovery");
    expect(d.paragraphs[3]).toContain("Sub-20 min 5K");
  });

  it("flags the sleep debt and low habit consistency", () => {
    const habit: Habit = {
      id: "h",
      title: "Water",
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
      logs: { "2026-08-10": 1 },
      createdAt: "2026-01-01",
    };
    const d = buildDigestFallback({
      days,
      workouts: [],
      habits: [habit],
      todayIso: "2026-08-10",
      goal: "",
    });
    // need 480 vs ~379 avg → ~100+ min debt per night
    expect(d.paragraphs[1]).toContain("sleep debt");
    // 1 done / 7 due → low consistency
    expect(d.paragraphs[2]).toContain("habit consistency");
  });
});
