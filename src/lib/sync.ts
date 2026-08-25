// ---------------------------------------------------------------------------
// Cloud sync (opt-in). The app stays local-first: sync only runs when the
// user enables it in Settings, which requires Supabase env vars + a signed-in
// Supabase account. A "snapshot" is the user's full rythm-* localStorage
// state pushed to the user_snapshots table as JSONB. Conflict resolution is
// last-write-wins by updated_at: newer side wins; the device reloads after a
// pull so the store re-initializes from the freshest data. This module never
// imports the store — callers (store actions / App) own the orchestration.
// ---------------------------------------------------------------------------

import type { Profile } from "../types";
import { supabase, supabaseAvailable } from "./supabase";
import { restoreLocalData, snapshotLocalData } from "./vault";

const LAST_SYNC_KEY = "rythm-last-synced";

export function lastSyncedAt(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

export function setLastSyncedAt(iso: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso);
  } catch {
    /* ignore */
  }
}

export interface SyncDirection {
  /** cloud is newer (or only cloud exists) → pull and reload */
  pull: boolean;
  /** local is newer (or only local exists) → push */
  push: boolean;
}

/**
 * Decide push vs pull by comparing the last local sync time against the
 * cloud snapshot's updated_at. Pure + testable:
 *   - no cloud row           → push local (first sync)
 *   - no local sync record   → pull cloud (this device never synced)
 *   - cloud newer than local → pull
 *   - local newer/equal      → push
 */
export function pickSyncDirection(
  local: string | null,
  cloud: string | null
): SyncDirection {
  if (!cloud) return { pull: false, push: true };
  if (!local) return { pull: true, push: false };
  return cloud > local
    ? { pull: true, push: false }
    : { pull: false, push: true };
}

export interface SyncResult {
  ok: boolean;
  reason?: "no-supabase" | "no-session" | "no-table";
  /** true when cloud data was applied locally — caller should reload */
  applied: boolean;
  pushed: boolean;
  error?: string;
}

function currentUser() {
  if (!supabase) {
    return Promise.resolve({ data: { session: null }, error: null } as const);
  }
  return supabase.auth.getSession();
}

/**
 * One sync pass: pull if the cloud is newer, push if local is newer.
 * After a pull the caller reloads the app so the store re-initializes.
 */
export async function syncOnce(): Promise<SyncResult> {
  if (!supabaseAvailable || !supabase) return { ok: false, reason: "no-supabase", applied: false, pushed: false };
  try {
    const { data } = await currentUser();
    const session = data.session;
    if (!session) return { ok: false, reason: "no-session", applied: false, pushed: false };

    const local = lastSyncedAt();
    const { data: row } = await supabase
      .from("user_snapshots")
      .select("data, updated_at")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const cloud = row?.updated_at ?? null;
    const dir = pickSyncDirection(local, cloud);

    if (dir.pull && row) {
      // Cloud is newer — apply it locally (the caller reloads the app).
      restoreLocalData(JSON.stringify(row.data));
      setLastSyncedAt(row.updated_at);
      return { ok: true, applied: true, pushed: false };
    }

    // Local is newer (or there's no cloud row yet) — push our full state.
    const now = new Date().toISOString();
    const payload = JSON.parse(snapshotLocalData()) as Record<string, string>;
    const { error } = await supabase.from("user_snapshots").upsert(
      {
        user_id: session.user.id,
        data: payload,
        schema_version: 1,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );
    if (error) return { ok: false, reason: "no-table", applied: false, pushed: false, error: error.message };
    setLastSyncedAt(now);
    return { ok: true, applied: false, pushed: true };
  } catch (e) {
    return { ok: false, applied: false, pushed: false, error: String(e) };
  }
}

/** Delete this user's cloud rows (Delete account). */
export async function deleteCloudData(): Promise<void> {
  if (!supabaseAvailable || !supabase) return;
  try {
    const { data } = await currentUser();
    const uid = data.session?.user.id;
    if (!uid) return;
    await supabase.from("user_snapshots").delete().eq("user_id", uid);
    await supabase.from("profiles").delete().eq("id", uid);
  } catch {
    /* best-effort — local delete always proceeds */
  }
}

/** Sign the Supabase session out (local logout stays instant). */
export async function signOutCloud(): Promise<void> {
  if (!supabaseAvailable || !supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore — local logout already happened */
  }
}

/** Keep a profile row in sync with the local account (created lazily). The
 * extra fields power real friend discovery: phone (contacts matching),
 * avatar_url (photos) and goal (what they're training for) — plus the full
 * onboarding profile (birthday/age/sex/weight/height), which lets a
 * returning user on a NEW device restore their profile and skip first-run
 * setup (see fetchCloudProfile). */
export async function upsertProfile(
  email: string,
  name: string,
  extra?: {
    phone?: string;
    avatar?: string;
    goal?: string;
    birthday?: string;
    age?: number;
    sex?: string;
    weightKg?: number;
    heightCm?: number;
    profileCreatedAt?: string;
  }
): Promise<void> {
  if (!supabaseAvailable || !supabase) return;
  try {
    const { data } = await currentUser();
    const uid = data.session?.user.id;
    if (!uid) return;
    await supabase
      .from("profiles")
      .upsert({
        id: uid,
        email,
        name,
        phone: extra?.phone ?? null,
        avatar_url: extra?.avatar ?? null,
        goal: extra?.goal ?? null,
        birthday: extra?.birthday ?? null,
        age: extra?.age ?? null,
        sex: extra?.sex ?? null,
        weight_kg: extra?.weightKg ?? null,
        height_cm: extra?.heightCm ?? null,
        profile_created_at: extra?.profileCreatedAt ?? null,
        updated_at: new Date().toISOString(),
      });
  } catch {
    /* best-effort — the local profile remains the source of truth */
  }
}

/**
 * Fetch the account's profile from the cloud, if one exists. Tries the
 * profiles row first (populated since migration 0004); falls back to the
 * opt-in sync snapshot's per-account keys, which covers accounts that
 * onboarded before those columns existed. Returns null when neither has a
 * usable profile — the caller then shows first-run setup (a genuinely new
 * account, or one that never reached the cloud).
 */
export async function fetchCloudProfile(email: string): Promise<Profile | null> {
  if (!supabaseAvailable || !supabase) return null;
  try {
    const { data } = await currentUser();
    const uid = data.session?.user.id;
    if (!uid) return null;

    const { data: row } = await supabase
      .from("profiles")
      .select(
        "name, birthday, age, sex, weight_kg, height_cm, goal, phone, avatar_url, profile_created_at"
      )
      .eq("id", uid)
      .maybeSingle();
    if (row?.age && row?.birthday) {
      return {
        name: row.name ?? "",
        birthday: row.birthday,
        age: row.age,
        sex: row.sex === "female" ? "female" : "male",
        weightKg: Number(row.weight_kg ?? 0),
        heightCm: Number(row.height_cm ?? 0),
        goal: row.goal ?? "",
        phone: row.phone ?? undefined,
        avatar: row.avatar_url ?? undefined,
        profileCreatedAt: row.profile_created_at ?? undefined,
      };
    }

    const { data: snap } = await supabase
      .from("user_snapshots")
      .select("data")
      .eq("user_id", uid)
      .maybeSingle();
    if (snap?.data) {
      const em = email.toLowerCase();
      const raw = (snap.data as Record<string, string>)[`rythm-profile-${em}`];
      if (raw) {
        const p = JSON.parse(raw) as Profile;
        if (p && typeof p.age === "number" && p.name) return p;
      }
    }
    return null;
  } catch {
    return null;
  }
}
