import { describe, expect, it } from "vitest";
import { RECOVERY_WEIGHTS, baselineAndSd, computeRecovery, recoveryColor } from "../recovery";
import type { DailyMetrics } from "../../types";

const base = {
  baselineHrv: 60,
  sdHrv: 6,
  baselineRhr: 55,
  sdRhr: 2,
  baselineTemp: 36.3,
  sdTemp: 0.2,
};

describe("computeRecovery", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(RECOVERY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("scores high when HRV is up, RHR is down and sleep is great", () => {
    const score = computeRecovery({
      hrv: 78, // +3 SD vs baseline
      rhr: 51, // -2 SD
      sleepScore: 92,
      skinTemp: 36.3,
      ...base,
    });
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it("scores low when HRV is down, RHR is up and sleep is poor", () => {
    const score = computeRecovery({
      hrv: 42, // -3 SD
      rhr: 61, // +3 SD
      sleepScore: 30,
      skinTemp: 36.9, // elevated temp
      ...base,
    });
    expect(score).toBeLessThanOrEqual(40);
  });

  it("clamps to 0..100", () => {
    const low = computeRecovery({ hrv: 1, rhr: 99, sleepScore: 0, skinTemp: 40, ...base });
    const high = computeRecovery({ hrv: 120, rhr: 30, sleepScore: 100, skinTemp: 36.3, ...base });
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(100);
    expect(low).toBeLessThan(high);
  });

  it("handles zero standard deviation (flat history)", () => {
    const score = computeRecovery({
      hrv: 60,
      rhr: 55,
      sleepScore: 80,
      skinTemp: 36.3,
      baselineHrv: 60,
      sdHrv: 0,
      baselineRhr: 55,
      sdRhr: 0,
      baselineTemp: 36.3,
      sdTemp: 0,
    });
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe("recoveryColor", () => {
  it("maps bands to green/yellow/red", () => {
    expect(recoveryColor(80)).toBe("green");
    expect(recoveryColor(50)).toBe("yellow");
    expect(recoveryColor(20)).toBe("red");
    expect(recoveryColor(67)).toBe("green");
    expect(recoveryColor(34)).toBe("yellow");
  });
});

describe("baselineAndSd", () => {
  it("computes mean and stddev", () => {
    const days = [
      { hrv: 50 },
      { hrv: 60 },
      { hrv: 70 },
    ] as unknown as DailyMetrics[];
    const { baseline, sd } = baselineAndSd(days, (d) => d.hrv);
    expect(baseline).toBe(60);
    expect(sd).toBeCloseTo(8.16, 1);
  });
});
