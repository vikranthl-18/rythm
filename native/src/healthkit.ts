// ---------------------------------------------------------------------------
// Apple HealthKit reader (@kayzmann/expo-healthkit).
//
// HealthKit is the ONLY way to reach Apple Watch data — Apple does not expose
// heart rate over generic BLE to third parties. This reader pulls the same
// metric families the web app's sim produces, so the merge engine treats an
// iPhone + Apple Watch exactly like any other device slot.
//
// IMPORTANT: the module is loaded LAZILY, never at import time. The package
// calls requireNativeModule('ExpoHealthKit') at module scope, and that native
// module does not exist on Android — so a static import would throw the
// moment the JS bundle loads, crashing the app on every Android launch.
// healthKit() below only requires the package when running on iOS.
//
// Note: this package currently exposes heart-rate/steps/sleep/SpO₂/resting-HR
// reads but NOT an HRV read function (the permission type exists). HRV is
// marked as a TODO below — the moment the package ships a getHRVSamples, wire
// it in the same one-line pattern.
// ---------------------------------------------------------------------------

import { Platform } from "react-native";
import type { NativeRecord, NativeSource } from "./types";

export const healthKitSource: NativeSource = {
  deviceId: "apple-watch",
  deviceName: "Apple Watch",
  kind: "healthkit",
};

type HealthKit = typeof import("@kayzmann/expo-healthkit");

let hk: HealthKit | null = null;

/** Lazy accessor — only ever touches the HealthKit module on iOS. */
function healthKit(): HealthKit | null {
  if (Platform.OS !== "ios") return null;
  if (!hk) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    hk = require("@kayzmann/expo-healthkit");
  }
  return hk;
}

/** True on iOS devices where HealthKit exists (never on Android). */
export function isHealthKitAvailable(): boolean {
  return healthKit()?.isAvailable() ?? false;
}

/** Ask the user for read-only access to everything we consume. */
export async function requestHealthKitPermissions(): Promise<boolean> {
  const kit = healthKit();
  if (!kit) return false;
  try {
    await kit.requestAuthorization(
      [
        "HeartRate",
        "RestingHeartRate",
        "HeartRateVariability", // permission only — no read fn yet (TODO)
        "Steps",
        "ActiveEnergy",
        "Sleep",
        "OxygenSaturation",
        "Workout",
      ],
      [] // write-only nothing — read-only app
    );
    return true;
  } catch {
    return false;
  }
}

const MS = 1000; // this package's sample timestamps are epoch SECONDS
const DAY_MS = 86_400_000;

/** Local YYYY-MM-DD for a Date (the package's timestamps are epoch seconds). */
function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * High-frequency metrics (heart rate, SpO2) are sampled continuously, so even
 * a "full history" read keeps them capped at this many days — the payload stays
 * light while daily/aggregate metrics (sleep, steps, resting HR, calories…)
 * use the full requested range.
 */
const CONTINUOUS_CAP_DAYS = 7;

/** Pull every supported record over the last `days` (default: 1). */
export async function readHealthKit(days = 1): Promise<NativeRecord[]> {
  const kit = healthKit();
  if (!kit || !kit.isAvailable()) return [];
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);
  const cap = Math.min(days, CONTINUOUS_CAP_DAYS);
  const hrStart = new Date(end.getTime() - cap * DAY_MS);
  const out: NativeRecord[] = [];

  // Heart rate — one record per reading.
  const hr = await kit.getHeartRateSamples(hrStart, end, 500);
  for (const s of hr) {
    out.push({
      type: "heartRate",
      start: new Date(s.startDate * MS).toISOString(),
      end: new Date(s.endDate * MS).toISOString(),
      value: s.value,
    });
  }

  const resting = await kit.getRestingHeartRate(start, end);
  if (resting != null) {
    out.push({ type: "restingHR", start: end.toISOString(), end: end.toISOString(), value: resting });
  }

  // TODO: HRV — the package has no getHRVSamples yet; add when it ships
  // (same pattern as getHeartRateSamples → { type: "hrv", value }).

  // Steps — one record per local day. The package only exposes a range total,
  // so a single call would lump every day of the range onto the range's start
  // date (and make "today" a rolling window total). Looping per midnight keeps
  // today exactly midnight-based.
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(end.getTime() - i * DAY_MS);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const daySteps = await kit.getSteps(dayStart, dayEnd);
    if (daySteps > 0) {
      out.push({ type: "steps", start: dayStart.toISOString(), end: dayEnd.toISOString(), value: daySteps });
    }
  }

  const spo2 = await kit.getOxygenSaturation(hrStart, end, 100);
  for (const s of spo2) {
    // HealthKit stores oxygen saturation as 0..1 — convert to %.
    out.push({
      type: "spo2",
      start: new Date(s.startDate * MS).toISOString(),
      end: new Date(s.endDate * MS).toISOString(),
      value: s.value * 100,
    });
  }

  // Sleep — aggregate stage minutes into one record per night, labelled by the
  // day the session ENDS (the morning you wake up) so "last night" shows on
  // today — same convention as the Android reader.
  const sleep = await kit.getSleepSamples(start, end);
  const byNight = new Map<string, { deep: number; light: number; rem: number; awake: number; first: number; last: number }>();
  for (const s of sleep) {
    if (s.value === "inBed" || s.value === "unknown") continue; // not asleep
    const night = localDay(new Date(s.endDate * MS));
    const slot = byNight.get(night) ?? { deep: 0, light: 0, rem: 0, awake: 0, first: s.startDate, last: s.endDate };
    const min = s.duration / 60;
    if (s.value === "deep") slot.deep += min;
    else if (s.value === "rem") slot.rem += min;
    else if (s.value === "awake") slot.awake += min;
    else slot.light += min; // 'asleep' + 'core' → light stage
    slot.first = Math.min(slot.first, s.startDate);
    slot.last = Math.max(slot.last, s.endDate);
    byNight.set(night, slot);
  }
  for (const [, slot] of byNight) {
    const total = slot.deep + slot.light + slot.rem + slot.awake;
    if (total <= 0) continue;
    out.push({
      type: "sleep",
      start: new Date(slot.first * MS).toISOString(),
      end: new Date(slot.last * MS).toISOString(),
      value: total,
      sleepStages: {
        deepMin: slot.deep,
        lightMin: slot.light,
        remMin: slot.rem,
        awakeMin: slot.awake,
      },
    });
  }

  return out;
}
