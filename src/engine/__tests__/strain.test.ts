import { describe, expect, it } from "vitest";
import {
  STRAIN_MAX,
  accrueStrain,
  strainFromWeighted,
  strainTarget,
  workoutStrainFromZones,
  zoneFor,
} from "../zones";

describe("zoneFor", () => {
  it("maps HR fractions to zones", () => {
    const max = 190;
    expect(zoneFor(100, max)).toBe(1); // 53%
    expect(zoneFor(124, max)).toBe(2); // 65%
    expect(zoneFor(142, max)).toBe(3); // 75%
    expect(zoneFor(162, max)).toBe(4); // 85%
    expect(zoneFor(180, max)).toBe(5); // 95%
  });
});

describe("strain accumulation", () => {
  it("starts at zero and never exceeds 21", () => {
    expect(strainFromWeighted(0)).toBe(0);
    expect(strainFromWeighted(1e9)).toBeLessThanOrEqual(STRAIN_MAX);
  });

  it("is non-decreasing in weighted minutes (saturates at 21)", () => {
    let prev = -1;
    for (let w = 0; w < 5000; w += 37) {
      const s = strainFromWeighted(w);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("earns far more strain in hard zones than idle zones", () => {
    const max = 190;
    // one hour at Z1 (light)
    let light = { strain: 0, weightedMinutes: 0 };
    for (let m = 0; m < 60; m++) light = accrueStrain(light, 100, max, 1);
    // one hour at Z4 (hard)
    let hard = { strain: 0, weightedMinutes: 0 };
    for (let m = 0; m < 60; m++) hard = accrueStrain(hard, 165, max, 1);
    expect(hard.strain).toBeGreaterThan(light.strain * 4);
  });

  it("workout strain favors zone-heavy sessions", () => {
    const easy = workoutStrainFromZones(30, 20, 5, 0, 0);
    const hard = workoutStrainFromZones(5, 10, 20, 15, 5);
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeLessThanOrEqual(STRAIN_MAX);
  });
});

describe("strainTarget", () => {
  it("scales with recovery", () => {
    expect(strainTarget(80)).toBeGreaterThan(strainTarget(50));
    expect(strainTarget(50)).toBeGreaterThan(strainTarget(20));
    expect(strainTarget(20)).toBeLessThanOrEqual(4);
  });
});
