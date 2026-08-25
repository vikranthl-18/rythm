// ---------------------------------------------------------------------------
// Types shared between the native readers and the merge engine.
// KEEP IN SYNC with ../src/engine/priority.ts and ../src/types.ts (web app).
// The web app's store is the documented swap point: real samples from the
// native bridge replace the simulated tick, and everything downstream
// (recovery, strain, Rythm Score, coach context) is unchanged.
// ---------------------------------------------------------------------------

/** Same union as the web app's MetricKey. */
export type MetricKey =
  | "hr"
  | "sleep"
  | "restingHR"
  | "hrv"
  | "steps"
  | "activeEnergy"
  | "calories"
  | "zoneMinutes"
  | "skinTemp"
  | "spo2"
  | "respRate";

/** The priority engine's input — one reading from one device at one time. */
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
 * A platform-neutral health record read from the native SDKs. Each platform
 * reader converts its SDK records into this shape; bridge.ts turns them into
 * MergeSample[].
 */
export interface NativeRecord {
  type: "heartRate" | "restingHR" | "hrv" | "steps" | "activeEnergy" | "calories"
    | "zoneMinutes" | "sleep" | "spo2" | "skinTemp";
  /** ISO timestamp of the start of the measurement window. */
  start: string;
  /** ISO timestamp of the end of the measurement window. */
  end: string;
  value: number;
  /** Sleep only: minutes in each stage (deep/light/rem/awake). */
  sleepStages?: { deepMin: number; lightMin: number; remMin: number; awakeMin: number };
  /**
   * Health Connect data origin — the package of the app/device that wrote
   * this record (e.g. "com.google.android.apps.fitness" for the Pixel Watch
   * via Fit, the ring app for the ring). Drives per-device rows so the web
   * app's Devices tab shows the watch AND the ring as separate slots.
   */
  origin?: string;
}

/** A paired source — one entry per web-app device slot (Pixel Watch 2 = Slot 1). */
export interface NativeSource {
  /** Must match the web app's device slot id. */
  deviceId: string;
  /** Shown in the web app's Devices tab. */
  deviceName: string;
  /** HealthKit data type or Health Connect record type this source covers. */
  kind: "healthkit" | "healthconnect";
}
