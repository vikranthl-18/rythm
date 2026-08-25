import { describe, expect, it } from "vitest";
import {
  aiMetricExplainers,
  computeAiMetrics,
  expectedHrv,
  expectedRhr,
  expectedVo2,
  vo2Label,
  type AiInput,
} from "../aiMetrics";

const base: AiInput = {
  age: 28,
  sex: "male",
  weightKg: 72,
  heightCm: 178,
  restingHR: 54,
  hrv: 62,
  days: Array.from({ length: 14 }, (_, i) => ({
    recovery: 55 + (i % 5) * 8,
    strain: 4 + (i % 3),
  })),
};

describe("computeAiMetrics", () => {
  it("estimates VO2max with the Uth formula", () => {
    const ai = computeAiMetrics(base);
    // 15.3 × (220 − 28) ÷ 54
    expect(ai.vo2max).toBeCloseTo((15.3 * 192) / 54, 1);
    expect(ai.maxHr).toBe(192);
  });

  it("ranks VO2max against age/sex norms", () => {
    const ai = computeAiMetrics(base);
    expect(ai.vo2Expected).toBeCloseTo(56 - 0.35 * 28, 1); // 46.2
    expect(ai.vo2Label).toBe(vo2Label(ai.vo2max, ai.vo2Expected));
    expect(ai.vo2Pct).toBeGreaterThanOrEqual(0);
    expect(ai.vo2Pct).toBeLessThanOrEqual(100);
  });

  it("keeps biological age near chronological age for a fit profile", () => {
    const ai = computeAiMetrics(base);
    expect(ai.biologicalAge).toBeGreaterThan(18);
    expect(ai.biologicalAge).toBeLessThan(40);
    // fit profile → score above 50 → younger than calendar age
    expect(ai.fitnessScore).toBeGreaterThan(50);
    expect(ai.biologicalAge).toBeLessThan(28);
  });

  it("makes a sedentary profile score low and biologically older", () => {
    const unfit: AiInput = {
      ...base,
      restingHR: 78,
      hrv: 30,
      days: base.days.map((d) => ({ ...d, recovery: 30, strain: 1 })),
    };
    const ai = computeAiMetrics(unfit);
    expect(ai.fitnessScore).toBeLessThan(50);
    expect(ai.biologicalAge).toBeGreaterThan(28);
  });

  it("maps recovery trend + load to a training status", () => {
    const peaking = computeAiMetrics({
      ...base,
      days: Array.from({ length: 14 }, () => ({ recovery: 80, strain: 12 })),
    });
    expect(peaking.trainingStatus).toBe("Peaking");

    const detraining = computeAiMetrics({
      ...base,
      days: Array.from({ length: 14 }, () => ({ recovery: 50, strain: 1 })),
    });
    expect(detraining.trainingStatus).toBe("Detraining");
  });

  it("computes RMR via Mifflin-St Jeor (male +5)", () => {
    const ai = computeAiMetrics(base);
    expect(ai.rmrKcal).toBe(Math.round(10 * 72 + 6.25 * 178 - 5 * 28 + 5));
  });
});

describe("norms", () => {
  it("declines HRV norm and raises RHR norm with age", () => {
    expect(expectedHrv(20)).toBeGreaterThan(expectedHrv(60));
    expect(expectedRhr(20)).toBeLessThan(expectedRhr(60));
    expect(expectedVo2(20, "male")).toBeGreaterThan(expectedVo2(60, "male"));
  });

  it("labels VO2max deltas sensibly", () => {
    expect(vo2Label(60, 46)).toBe("Excellent");
    expect(vo2Label(50, 46)).toBe("Very good");
    expect(vo2Label(45, 46)).toBe("Good");
    expect(vo2Label(38, 46)).toBe("Fair");
    expect(vo2Label(30, 46)).toBe("Poor");
  });

  it("produces an explainer for every headline metric", () => {
    const ai = computeAiMetrics(base);
    const rows = aiMetricExplainers(ai, base);
    const labels = rows.map((r) => r.label);
    for (const want of ["VO₂max", "Fitness score", "Biological age", "Training status", "Max heart rate"]) {
      expect(labels).toContain(want);
    }
    rows.forEach((r) => expect(r.body.length).toBeGreaterThan(40));
  });
});
