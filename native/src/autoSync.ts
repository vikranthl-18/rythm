// ---------------------------------------------------------------------------
// Auto-sync — Health Connect → Supabase, with no buttons.
//
// Runs at the App level (always mounted, regardless of which tab is open):
//   • once shortly after launch, once a session exists
//   • every time the app returns to the foreground
//   • every 15 minutes while it's open (catches a workout in progress)
//
// Guard rails so it's quiet and polite:
//   • Android only — iOS HealthKit auto-sync can be added with the same hook
//   • never pops the permission dialog; if the user hasn't connected yet it
//     waits and the Health tab's Read button remains the onboarding step
//   • throttled to once per 10 minutes (except the first launch run)
//   • only reports batches that actually changed (the upsert is idempotent)
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  healthConnectPermitted,
  healthConnectStatus,
  readHealthConnect,
} from "./healthconnect";
import { currentUserEmail, pushRecords } from "./sync";
import { healthConnectSource } from "./healthconnect";

export type AutoSyncState = "idle" | "waiting-session" | "not-android" | "waiting-permission" | "syncing" | "done" | "error";

export interface AutoSyncStatus {
  state: AutoSyncState;
  /** Human line for the status strip. */
  text: string;
  /** True when this run pushed at least one batch (web should re-pull). */
  pushed?: boolean;
  /** ISO time of the last successful push. */
  lastSyncAt?: string;
}

const MIN_INTERVAL_MS = 10 * 60_000; // don't hammer Health Connect / Supabase
const PERIODIC_MS = 15 * 60_000; // background pick-up while the app is open
const AUTO_READ_DAYS = 3; // yesterday + today + slack, so days start at midnight

export function useAutoSync(sharedEmail: string | null, retryTick = 0): AutoSyncStatus {
  const [status, setStatus] = useState<AutoSyncStatus>({ state: "idle", text: "" });
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  const run = useCallback(async (force = false) => {
    // One run at a time — a foreground event while a sync is mid-flight just
    // gets skipped (the in-flight one already covers it).
    if (runningRef.current) return;
    const now = Date.now();
    // Throttle except when forced — force is only used right after the user
    // grants Health Connect permission on the Health tab, where an immediate
    // run is exactly what they asked for (and a user action, not a loop).
    if (!force && now - lastRunRef.current < MIN_INTERVAL_MS && lastRunRef.current !== 0) return;

    runningRef.current = true;
    try {
      if (Platform.OS !== "android") {
        setStatus({ state: "not-android", text: "Auto-sync: iOS HealthKit coming soon" });
        return;
      }
      const email = await currentUserEmail();
      if (!email) {
        setStatus({ state: "waiting-session", text: "Auto-sync: waiting for sign-in" });
        return;
      }
      const hc = await healthConnectStatus();
      if (hc !== "available" && hc !== "unknown") {
        setStatus({ state: "waiting-permission", text: "Auto-sync: Health Connect not installed" });
        return;
      }
      const permitted = await healthConnectPermitted();
      if (!permitted) {
        setStatus({
          state: "waiting-permission",
          text: "Auto-sync: open Health tab → tap Read to connect Health Connect",
        });
        return;
      }

      setStatus({ state: "syncing", text: "Auto-sync: reading your devices…" });
      const records = await readHealthConnect(AUTO_READ_DAYS);
      const res = await pushRecords(records, healthConnectSource);
      if (res.ok) {
        const when = new Date().toISOString();
        lastRunRef.current = now;
        const hasData = (res.pushed ?? 0) > 0;
        setStatus({
          state: "done",
          pushed: hasData,
          lastSyncAt: when,
          text: hasData
            ? `Auto-sync ✓ synced ${res.pushed} batch${res.pushed === 1 ? "" : "es"} just now`
            : `Auto-sync ✓ up to date (${new Date(when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`,
        });
      } else {
        lastRunRef.current = now; // avoid retrying a broken config every foreground
        setStatus({ state: "error", text: `Auto-sync: ${res.error}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ state: "error", text: `Auto-sync: ${msg}` });
    } finally {
      runningRef.current = false;
    }
  }, []);

  // Trigger on launch + every foreground. run() self-guards on the session,
  // so the hook is ALWAYS armed — a session appearing later (web session poll
  // adoption) is picked up by the sharedEmail effect below.
  useEffect(() => {
    const boot = setTimeout(() => void run(), 2500);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    return () => {
      clearTimeout(boot);
      sub.remove();
    };
  }, [run]);

  // The web app's session is adopted a few seconds after launch (4s poll) —
  // run as soon as it lands so the first auto-sync isn't delayed by a whole
  // interval. Also re-runs when the user signs in later.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (sharedEmail && !wasSignedIn.current) {
      wasSignedIn.current = true;
      const t = setTimeout(() => void run(), 1200);
      return () => clearTimeout(t);
    }
    if (!sharedEmail) wasSignedIn.current = false;
  }, [sharedEmail, run]);

  // Periodic pick-up while the app is open (catches a run in progress).
  useEffect(() => {
    const id = setInterval(() => void run(), PERIODIC_MS);
    return () => clearInterval(id);
  }, [run]);

  // Light 30s retry while waiting for a session or permission. run() early-
  // returns without touching Health Connect in those states (no dialogs, no
  // reads), and the 10-min throttle blocks it once a real sync has happened
  // — so this only actively retries when something is still pending, e.g. a
  // web session adopted a few seconds after launch or a permission granted on
  // the Health tab.
  useEffect(() => {
    const id = setInterval(() => void run(), 30_000);
    return () => clearInterval(id);
  }, [run]);

  // A permission grant just happened on the Health tab (the user tapped Read
  // and approved) — run immediately, bypassing the throttle, so the strip
  // turns green the moment they finish instead of waiting for the 30s retry.
  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    if (retryTick > 0) void run(true);
  }, [retryTick, run]);

  return status;
}
