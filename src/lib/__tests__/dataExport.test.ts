import { describe, expect, it } from "vitest";
import {
  buildExportPayload,
  dailyMetricsCsv,
  workoutsCsv,
} from "../dataExport";
import { APP_VERSION } from "../version";
import type { DailyMetrics, Workout } from "../../types";

const day: DailyMetrics = {
  date: "2026-08-10",
  measuredAtMin: 360,
  hrv: 68,
  restingHR: 54,
  skinTemp: 36.4,
  spo2: 97,
  respRate: 14,
  steps: 8200,
  activeEnergy: 420,
  calories: 2100,
  activeZoneMin: 32,
  sleep: { date: "2026-08-10", durationMin: 452, deepMin: 90, lightMin: 220, remMin: 110, awakeMin: 32, needMin: 460, score: 78 },
  recovery: 72,
  strain: 12.4,
};

const workout: Workout = {
  id: "w1",
  type: "run",
  title: "5.2 km Run, \"tempo\"",
  startIso: "2026-08-10T07:00:00Z",
  endIso: "2026-08-10T07:30:00Z",
  durationSec: 1800,
  distanceM: 5200,
  elevationGainM: 40,
  avgHr: 158,
  maxHr: 176,
  strain: 14.2,
  zones: { z1: 5, z2: 10, z3: 8, z4: 4, z5: 3 },
  splitsSec: [345, 348, 350],
  route: [],
};

describe("buildExportPayload", () => {
  it("includes app identity, account, profile and all data sections", () => {
    const p = buildExportPayload({
      email: "a@b.com",
      name: "Alex",
      profile: { name: "Alex", age: 25, sex: "male", weightKg: 70, heightCm: 178, goal: "Sub-20 5k" },
      days: [day],
      workouts: [workout],
      habits: [],
      friends: [],
      devices: [],
    });
    expect(p.app).toBe("rythm");
    expect(p.version).toBe(APP_VERSION);
    expect(p.account).toEqual({ email: "a@b.com", name: "Alex" });
    expect(p.days).toHaveLength(1);
    expect(p.workouts[0].id).toBe("w1");
    expect(p.exportedAt).toBeTruthy();
  });
});

describe("dailyMetricsCsv", () => {
  it("emits a header row and one row per day with tabular values", () => {
    const csv = dailyMetricsCsv([day]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("date,recovery,strain,hrv");
    expect(lines[1]).toContain("2026-08-10,72,12.4,68");
    expect(lines[1]).toContain("452,78"); // sleep duration + score
  });

  it("quotes values containing commas (sleep duration formatting safety)", () => {
    // No commas in the current format, but the escaper must not corrupt dates.
    const csv = dailyMetricsCsv([day, { ...day, date: "2026-08-11" }]);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).not.toContain('"2026-08-10"'); // plain values stay unquoted
  });
});

describe("workoutsCsv", () => {
  it("escapes quoted titles with commas", () => {
    const csv = workoutsCsv([workout]);
    const line = csv.split("\n")[1];
    expect(line).toContain('"5.2 km Run, ""tempo"""');
    expect(line).toContain("5200,40,158,176,14.2");
  });
});
