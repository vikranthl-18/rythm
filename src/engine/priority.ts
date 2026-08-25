// ---------------------------------------------------------------------------
// Multi-device sync & priority resolution engine (Module 1)
//
// Rule 1 — Time overlap: when multiple devices record the same metric in the
//          same window, pick the sample from the higher-priority device.
// Rule 2 — Metric specialization: each metric category has its own device
//          ordering (e.g. ring first for sleep, watch first for steps).
// Rule 3 — Data imputation: if the top device has no recent sample (dropped
//          connection / dead battery), fall back to the next device in order.
// ---------------------------------------------------------------------------

import type { MetricKey, UserDevice } from "../types";

export interface MergeSample {
  deviceId: string;
  metric: MetricKey;
  /** sim minutes since midnight (or epoch minutes — any linear clock). */
  t: number;
  value: number;
}

export interface ResolvedReading {
  deviceId: string;
  deviceName: string;
  value: number;
  /** How many preferred devices were skipped (imputation depth). */
  fellBack: number;
  sampleT: number;
}

/**
 * Resolve the reading for `metric` at time `t` from all devices' samples.
 * Samples within `windowMin` of `t` compete; the device ranked first in that
 * metric's order wins (Rule 1 + Rule 2). If the winner has no sample, the
 * next device in order is tried (Rule 3).
 */
export function resolveAt(
  metric: MetricKey,
  devices: UserDevice[],
  samples: MergeSample[],
  t: number,
  windowMin = 8
): ResolvedReading | null {
  const order = effectiveOrder(metric, devices);
  for (let i = 0; i < order.length; i++) {
    const devId = order[i];
    const dev = devices.find((d) => d.id === devId);
    if (!dev) continue;
    if (!dev.connected && i > 0) {
      // disconnected primary still "wins" if it has a fresh sample; but if it
      // has none we fall through. Rule 3 keeps trying lower-priority devices.
    }
    const sample = samples
      .filter((s) => s.deviceId === devId && s.metric === metric)
      .filter((s) => Math.abs(s.t - t) <= windowMin)
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    if (sample) {
      return {
        deviceId: dev.id,
        deviceName: dev.name,
        value: sample.value,
        fellBack: i,
        sampleT: sample.t,
      };
    }
  }
  return null;
}

/**
 * Latest merged reading for a metric: newest sample from the top-ranked
 * device; if its newest sample is older than `staleMin`, impute from the next
 * device in the order.
 */
export function resolveLatest(
  metric: MetricKey,
  devices: UserDevice[],
  samples: MergeSample[],
  nowT: number,
  staleMin = 30
): ResolvedReading | null {
  const order = effectiveOrder(metric, devices);
  for (let i = 0; i < order.length; i++) {
    const devId = order[i];
    const dev = devices.find((d) => d.id === devId);
    if (!dev) continue;
    const candidates = samples
      .filter((s) => s.deviceId === devId && s.metric === metric)
      .sort((a, b) => b.t - a.t);
    const latest = candidates[0];
    if (latest && nowT - latest.t <= staleMin) {
      return {
        deviceId: dev.id,
        deviceName: dev.name,
        value: latest.value,
        fellBack: i,
        sampleT: latest.t,
      };
    }
    // no sample, or sample too stale → try next device (Rule 3)
  }
  return null;
}

/** The effective device order for a metric (respects per-metric overrides). */
export function effectiveOrder(metric: MetricKey, devices: UserDevice[]): string[] {
  const byRank = [...devices].sort((a, b) => a.priorityRank - b.priorityRank);
  const first = byRank[0];
  if (first && first.metricOrder[metric] && first.metricOrder[metric].length > 0) {
    const order = first.metricOrder[metric].filter((id) =>
      devices.some((d) => d.id === id)
    );
    // append any device missing from the override so nothing is unreachable
    for (const d of byRank) if (!order.includes(d.id)) order.push(d.id);
    return order;
  }
  return byRank.map((d) => d.id);
}

/** Which device is currently the "source of truth" for a metric, at a glance. */
export function activeSource(
  metric: MetricKey,
  devices: UserDevice[]
): UserDevice | null {
  const ids = effectiveOrder(metric, devices);
  for (const id of ids) {
    const dev = devices.find((d) => d.id === id);
    if (dev && dev.connected) return dev;
    // if the top device is disconnected, we'd impute from the next connected one
  }
  return null;
}

export function slotColor(rank: number): string {
  return ["#bd4444", "#60a5fa", "#a78bfa"][rank - 1] ?? "#9a8b7c";
}
