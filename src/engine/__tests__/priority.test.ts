import { describe, expect, it } from "vitest";
import type { MetricKey, UserDevice } from "../../types";
import { effectiveOrder, resolveAt, resolveLatest } from "../priority";

function device(id: string, rank: number, order: Record<MetricKey, string[]>): UserDevice {
  return {
    id,
    name: id,
    model: id,
    source: "BLE_DIRECT",
    priorityRank: rank,
    battery: 80,
    connected: true,
    lastSyncMin: 0,
    color: "#fff",
    metricOrder: order,
    specialty: [],
  };
}

const hrOrder: Record<MetricKey, string[]> = {
  hr: ["watch", "ring", "apple"],
  sleep: ["ring", "watch", "apple"],
  restingHR: ["watch", "ring", "apple"],
  hrv: ["ring", "watch", "apple"],
  steps: ["watch", "ring", "apple"],
  activeEnergy: ["watch", "ring", "apple"],
  calories: ["watch", "ring", "apple"],
  zoneMinutes: ["watch", "ring", "apple"],
  skinTemp: ["ring", "watch", "apple"],
  spo2: ["ring", "watch", "apple"],
  respRate: ["ring", "watch", "apple"],
};

const devices = [device("watch", 1, hrOrder), device("ring", 2, hrOrder), device("apple", 3, hrOrder)];

describe("Rule 1 — time overlap resolution", () => {
  it("picks the higher-priority device for overlapping windows", () => {
    const samples = [
      { deviceId: "watch", metric: "hr" as MetricKey, t: 100, value: 140 },
      { deviceId: "ring", metric: "hr" as MetricKey, t: 102, value: 138 },
    ];
    const r = resolveAt("hr", devices, samples, 101, 8);
    expect(r?.deviceId).toBe("watch"); // watch is primary for HR
    expect(r?.value).toBe(140);
    expect(r?.fellBack).toBe(0);
  });

  it("the winner is per-metric (Rule 2: ring leads sleep)", () => {
    const samples = [
      { deviceId: "watch", metric: "sleep" as MetricKey, t: 100, value: 470 },
      { deviceId: "ring", metric: "sleep" as MetricKey, t: 101, value: 485 },
    ];
    const r = resolveAt("sleep", devices, samples, 100, 8);
    expect(r?.deviceId).toBe("ring");
    expect(r?.value).toBe(485);
  });
});

describe("Rule 3 — imputation fallback", () => {
  it("falls back to the next device when the primary has no recent sample", () => {
    const samples = [
      { deviceId: "ring", metric: "hr" as MetricKey, t: 100, value: 138 },
      { deviceId: "apple", metric: "hr" as MetricKey, t: 100, value: 136 },
    ];
    const r = resolveAt("hr", devices, samples, 100, 8);
    expect(r?.deviceId).toBe("ring"); // watch missing → ring
    expect(r?.fellBack).toBe(1);
  });

  it("resolveLatest falls back on stale primary data", () => {
    const samples = [
      { deviceId: "watch", metric: "hr" as MetricKey, t: 500, value: 140 }, // 60 min old
      { deviceId: "ring", metric: "hr" as MetricKey, t: 556, value: 132 }, // 4 min old
    ];
    const r = resolveLatest("hr", devices, samples, 560, 30);
    expect(r?.deviceId).toBe("ring");
    expect(r?.value).toBe(132);
  });

  it("returns null when no device has data", () => {
    expect(resolveAt("hr", devices, [], 100, 8)).toBeNull();
    expect(resolveLatest("hr", devices, [], 100, 30)).toBeNull();
  });
});

describe("effectiveOrder", () => {
  it("respects per-metric overrides and appends missing devices", () => {
    const order = effectiveOrder("sleep", devices);
    expect(order).toEqual(["ring", "watch", "apple"]);
  });
});
