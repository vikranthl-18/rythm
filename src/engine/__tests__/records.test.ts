import { describe, expect, it } from "vitest";
import type { RoutePoint, Workout } from "../../types";
import { computeRecords, timeToDistance } from "../records";

/** Straight-line route at constant speed: points every 100 m. */
function route(speedMs: number, distM: number): RoutePoint[] {
  const pts: RoutePoint[] = [];
  const n = Math.floor(distM / 100);
  for (let i = 0; i <= n; i++) {
    pts.push({
      lat: 37.7694 + (i * 100) / 111320,
      lng: -122.4862,
      t: (i * 100) / speedMs,
      hr: 150,
      alt: 0,
    });
  }
  return pts;
}

function workout(id: string, type: Workout["type"], title: string, speedMs: number, distM: number, daysAgo: number): Workout {
  const start = new Date(Date.now() - daysAgo * 86400000);
  start.setHours(7, 0, 0, 0);
  const end = new Date(start.getTime() + (distM / speedMs) * 1000);
  return {
    id,
    type,
    title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    durationSec: Math.round(distM / speedMs),
    distanceM: distM,
    elevationGainM: 0,
    avgHr: 150,
    maxHr: 165,
    strain: 10,
    zones: { z1: 5, z2: 10, z3: 20, z4: 5, z5: 0 },
    splitsSec: [],
    route: route(speedMs, distM),
  };
}

describe("timeToDistance", () => {
  it("computes time at a distance for constant speed", () => {
    const r = route(4, 2000); // 4 m/s
    const t = timeToDistance(r, 1000);
    expect(t).toBeCloseTo(250, 0); // 1000 m at 4 m/s
  });

  it("returns null when the route is shorter than the target", () => {
    const r = route(4, 2000);
    expect(timeToDistance(r, 3000)).toBeNull();
  });
});

describe("computeRecords", () => {
  it("picks the fastest 5K across workouts", () => {
    const slow = workout("w1", "run", "Easy Run", 3, 5200, 5);
    const fast = workout("w2", "run", "Tempo Run", 4.2, 6000, 3);
    const records = computeRecords([slow, fast]);
    const fiveK = records.find((r) => r.label === "5K")!;
    expect(fiveK.main).toBe("19:52"); // 5000 m at 4.2 m/s, interpolated along the track
    expect(fiveK.detail).toContain("Tempo Run");
  });

  it("excludes non-running workouts from running PRs but uses them for cycling", () => {
    const ride = workout("w2", "cycle", "Long Ride", 8, 25000, 2);
    const records = computeRecords([ride]);
    expect(records.find((r) => r.label === "5K")?.main).toBeNull();
    const ride20 = records.find((r) => r.label === "20K ride")!;
    expect(ride20.main).not.toBeNull();
  });

  it("reports longest run and best 7-day volume", () => {
    const a = workout("w1", "run", "Short", 3, 4000, 4);
    const b = workout("w2", "trail", "Long", 3, 10000, 2);
    const c = workout("w3", "run", "Old", 3, 3000, 20); // outside the 7-day window
    const records = computeRecords([a, b, c]);
    expect(records.find((r) => r.label === "Longest run")?.main).toBe("10.0 km");
    const week = records.find((r) => r.label === "Best 7 days")!;
    expect(week.main).toBe("14.0 km"); // a + b (c is 20 days ago)
  });
});
