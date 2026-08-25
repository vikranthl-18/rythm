// ---------------------------------------------------------------------------
// Per-account core data (days, workouts, habits, devices).
//
// Demo accounts (the demo chooser) get the full seeded 14-day dataset. REAL
// accounts start blank — today's vitals only, no workouts/habits/devices —
// and their data is persisted per email so it stays blank (and stays *their*
// data) across reloads. Persisting here also makes cloud sync meaningful: the
// snapshot now includes each account's real data.
// ---------------------------------------------------------------------------

import type { DailyMetrics, Habit, UserDevice, Workout } from "../types";
import { buildSeed, isDemoEmail } from "../data/seed";

export interface AccountData {
  days: DailyMetrics[];
  workouts: Workout[];
  habits: Habit[];
  devices: UserDevice[];
}

const DATA_PREFIX = "rythm-data-";

// ---------------------------------------------------------------------------
// Deletion tombstone. "Delete account" writes rythm-deleted-<email> AFTER
// wiping rythm-* keys, so a re-signup with the same email (or a re-pick of a
// deleted demo account) starts genuinely blank instead of resurrecting old
// data from leftover per-account keys or a stale Supabase session.
// ---------------------------------------------------------------------------

const DELETED_PREFIX = "rythm-deleted-";

/** Whether this email has a pending "deleted — start fresh" marker. */
export function isDeletedAccount(email: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return !!localStorage.getItem(DELETED_PREFIX + email.toLowerCase());
  } catch {
    return false;
  }
}

/** Write the tombstone (call AFTER wiping local data so it survives). */
export function markDeletedAccount(email: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DELETED_PREFIX + email.toLowerCase(), new Date().toISOString());
  } catch {
    /* storage unavailable — a re-signup may resurrect data; acceptable */
  }
}

/** Remove the tombstone (called when the fresh re-signup consumes it). */
export function clearDeletedAccount(email: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(DELETED_PREFIX + email.toLowerCase());
  } catch {
    /* ignore */
  }
}

/** Every per-account key for one email (data, friends, requests, profile, onboarding, tour). */
const ACCOUNT_KEY_PREFIXES = [
  "rythm-data-",
  "rythm-friends-",
  "rythm-requests-",
  "rythm-profile-",
  "rythm-onboarded-",
  "rythm-tour-",
];

/**
 * Whether an account has a "device layer" that warrants the live simulation:
 * a configured device slot, a live BLE stream, or the demo dataset. Real
 * accounts with no device get honest "no data yet" states instead of
 * fabricated vitals.
 */
export function deviceLayerActive(
  devices: unknown[],
  bleConnected: boolean,
  email: string | null
): boolean {
  return devices.length > 0 || bleConnected || isDemoEmail(email);
}

/** Remove all residual per-account keys for one email. */
export function wipeAccountKeys(email: string): void {
  if (typeof localStorage === "undefined") return;
  const em = email.toLowerCase();
  try {
    for (const p of ACCOUNT_KEY_PREFIXES) localStorage.removeItem(p + em);
  } catch {
    /* storage unavailable — nothing to wipe */
  }
}

export function loadAccountData(email: string): AccountData | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DATA_PREFIX + email.toLowerCase());
    if (!raw) return null;
    const d = JSON.parse(raw) as AccountData;
    if (
      !Array.isArray(d.days) ||
      !Array.isArray(d.workouts) ||
      !Array.isArray(d.habits) ||
      !Array.isArray(d.devices)
    )
      return null;
    return d;
  } catch {
    return null;
  }
}

export function saveAccountData(email: string, d: AccountData): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DATA_PREFIX + email.toLowerCase(), JSON.stringify(d));
  } catch {
    /* storage unavailable — data just won't persist */
  }
}

/** The full demo dataset (today's live counters start at zero). */
export function demoAccountData(): AccountData {
  const seed = buildSeed();
  return {
    devices: structuredClone(seed.devices),
    days: seed.days.map((d, i) =>
      i === seed.days.length - 1 ? { ...d, steps: 0, activeEnergy: 0 } : d
    ),
    workouts: seed.workouts,
    habits: seed.habits,
  };
}

/**
 * A brand-new real account: a truly empty day — no inherited seed vitals, no
 * sleep, no recovery. Everything is zeroed so the UI shows honest "no data
 * yet" states (and the 7-day learning window) instead of the demo dataset's
 * numbers. The live sim also refuses to fabricate metrics for accounts with
 * no device layer, so this stays empty until real data arrives.
 */
export function freshAccountData(): AccountData {
  const seed = buildSeed();
  const today = seed.days[seed.days.length - 1];
  return {
    days: [
      {
        ...today,
        hrv: 0,
        restingHR: 0,
        skinTemp: 0,
        spo2: 0,
        respRate: 0,
        steps: 0,
        activeEnergy: 0,
        calories: 0,
        activeZoneMin: 0,
        strain: 0,
        recovery: 0,
        sleep: {
          ...today.sleep,
          durationMin: 0,
          deepMin: 0,
          lightMin: 0,
          remMin: 0,
          awakeMin: 0,
          needMin: 0,
          score: 0,
        },
      },
    ],
    workouts: [],
    habits: [],
    devices: [],
  };
}

/**
 * Resolve an account's data: saved data wins; otherwise demo accounts get the
 * seeded dataset and real accounts start fresh. Newly created data is saved
 * immediately so it survives reloads.
 */
export function accountDataFor(email: string | null): AccountData {
  if (email) {
    const saved = loadAccountData(email);
    if (saved) return saved;
  }
  const data = isDemoEmail(email) ? demoAccountData() : freshAccountData();
  if (email) saveAccountData(email, data);
  return data;
}
