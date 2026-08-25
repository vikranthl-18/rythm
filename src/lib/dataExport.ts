// ---------------------------------------------------------------------------
// Data export — "you own your data". Downloads a JSON snapshot of everything
// rythm knows about the account plus CSV spreadsheets of daily metrics and
// workouts. Pure functions so the payload shapes are unit-tested.
// ---------------------------------------------------------------------------

import { APP_VERSION, APP_NAME } from "./version";
import type { DailyMetrics, Friend, Habit, Profile, UserDevice, Workout } from "../types";

export interface ExportPayload {
  app: string;
  version: string;
  exportedAt: string;
  account: { email: string; name: string };
  profile: Profile;
  days: DailyMetrics[];
  workouts: Workout[];
  habits: Habit[];
  friends: Friend[];
  devices: UserDevice[];
}

export function buildExportPayload(input: {
  email: string;
  name: string;
  profile: Profile;
  days: DailyMetrics[];
  workouts: Workout[];
  habits: Habit[];
  friends: Friend[];
  devices: UserDevice[];
}): ExportPayload {
  return {
    app: APP_NAME,
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    account: { email: input.email, name: input.name },
    profile: input.profile,
    days: input.days,
    workouts: input.workouts,
    habits: input.habits,
    friends: input.friends,
    devices: input.devices,
  };
}

function csv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

/** Daily metrics as CSV rows (one per day). */
export function dailyMetricsCsv(days: DailyMetrics[]): string {
  return csv(
    ["date", "recovery", "strain", "hrv", "restingHR", "skinTemp", "spo2", "respRate", "steps", "activeEnergy", "calories", "activeZoneMin", "sleepDurationMin", "sleepScore"],
    days.map((d) => [
      d.date,
      d.recovery,
      d.strain,
      d.hrv,
      d.restingHR,
      d.skinTemp,
      d.spo2,
      d.respRate,
      d.steps,
      d.activeEnergy,
      d.calories,
      d.activeZoneMin,
      d.sleep.durationMin,
      d.sleep.score,
    ])
  );
}

/** Workouts as CSV rows (most recent first). */
export function workoutsCsv(workouts: Workout[]): string {
  return csv(
    ["start", "type", "title", "durationSec", "distanceM", "elevationGainM", "avgHr", "maxHr", "strain"],
    workouts.map((w) => [
      w.startIso,
      w.type,
      w.title,
      w.durationSec,
      w.distanceM,
      w.elevationGainM,
      w.avgHr,
      w.maxHr,
      w.strain,
    ])
  );
}

// ---------------------------------------------------------------------------
// DOM download helpers (small, browser-only)
// ---------------------------------------------------------------------------

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadJson(payload: ExportPayload): void {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`rythm-export-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
}

export function downloadCsv(filename: string, content: string): void {
  download(filename, "\uFEFF" + content, "text/csv;charset=utf-8");
}

/** Remove every rythm-* localStorage key (used by Delete account + crash reset). */
export function wipeLocalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("rythm-")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable — nothing to wipe */
  }
}
