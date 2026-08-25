// ---------------------------------------------------------------------------
// The bridge: NativeRecord[] → MergeSample[].
//
// This is the exact swap point the web app documents (src/store.ts sim →
// real device layer). Feed these samples into the priority-merge engine
// (src/engine/priority.ts in the web repo) and the same device-slot rules —
// Rule 1 time-overlap resolution, Rule 2 per-metric priority, Rule 3
// imputation fallback — apply to real hardware unchanged.
// ---------------------------------------------------------------------------

import type { MergeSample, MetricKey, NativeRecord, NativeSource } from "./types";

/** Minutes since local midnight — the merge engine's linear clock. */
function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export const RECORD_METRIC: Record<NativeRecord["type"], MetricKey> = {
  heartRate: "hr",
  restingHR: "restingHR",
  hrv: "hrv",
  steps: "steps",
  activeEnergy: "activeEnergy",
  calories: "calories",
  zoneMinutes: "zoneMinutes",
  skinTemp: "skinTemp",
  spo2: "spo2",
  sleep: "sleep",
};

/** Convert one native record to one or more merge samples for a device slot. */
export function recordToSamples(record: NativeRecord, source: NativeSource): MergeSample[] {
  const metric = RECORD_METRIC[record.type];
  const samples: MergeSample[] = [];

  if (record.type === "sleep" && record.sleepStages) {
    // Sleep is multi-valued: the engine's "sleep" metric consumes total
    // duration, and the stage breakdown rides along as its own samples so the
    // sleep-score engine (45% duration, 30% efficiency, 25% deep+REM) gets
    // what it needs. Timestamps use the session's END (the morning you wake
    // up), matching how the day-labelling in sync.ts keys a night.
    const { deepMin, lightMin, remMin, awakeMin } = record.sleepStages;
    const total = deepMin + lightMin + remMin + awakeMin;
    const base = minutesSinceMidnight(record.end);
    samples.push({ deviceId: source.deviceId, metric: "sleep", t: base, value: total });
    samples.push({ deviceId: source.deviceId, metric: "sleep", t: base + 1, value: deepMin });
    samples.push({ deviceId: source.deviceId, metric: "sleep", t: base + 2, value: remMin });
    samples.push({ deviceId: source.deviceId, metric: "sleep", t: base + 3, value: lightMin });
    samples.push({ deviceId: source.deviceId, metric: "sleep", t: base + 4, value: awakeMin });
    return samples;
  }

  samples.push({
    deviceId: source.deviceId,
    metric,
    t: minutesSinceMidnight(record.start),
    value: record.value,
  });
  return samples;
}

/** Convert a batch of records from one source into merge-engine samples. */
export function bridgeToSamples(records: NativeRecord[], source: NativeSource): MergeSample[] {
  return records.flatMap((r) => recordToSamples(r, source));
}
