// ---------------------------------------------------------------------------
// Supabase — real accounts, server-side Google token verification, opt-in
// cloud sync. Local-first stays the default: when the env vars below are
// unset, `supabaseAvailable` is false, `supabase` is null, and the app runs
// exactly as before (localStorage accounts, GIS demo Google, no sync).
//
// Security notes (why this is the production path):
//  - Google OAuth goes through Supabase Auth (signInWithOAuth). Supabase's
//    auth server exchanges and VERIFIES the Google ID token server-side —
//    the app never decodes an unverified client token in production.
//  - The anon key is public by design; it only gates access to tables your
//    RLS policies allow. See supabase/migrations/0001_init.sql: every table
//    is locked to auth.uid() = the row owner.
//  - Biometrics live in localStorage by default. Sync is opt-in per user.
// ---------------------------------------------------------------------------

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "../auth";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

/** True only when the app is configured with a Supabase project. */
export const supabaseAvailable: boolean =
  SUPABASE_URL.trim().length > 0 && SUPABASE_ANON_KEY.trim().length > 0;

/** The client, or null in fully-local mode. */
export const supabase: SupabaseClient | null = supabaseAvailable
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Synchronously drop the Supabase session from local storage so a relaunch
 * can't auto-restore it. supabase-js removes the persisted session only AFTER
 * its server-side revoke call returns, so a slow/offline sign-out would leave
 * the session live — the app would log the user straight back in on reopen.
 * This makes logout stick immediately; the server revoke still runs after.
 */
export function clearCloudSessionLocally(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/** Map a Supabase session to the app's AuthUser shape (metadata → profile). */
export function authUserFromSession(session: Session): AuthUser | null {
  const u = session.user;
  if (!u?.email) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const provider = (u.app_metadata?.provider as string | undefined) ?? "email";
  return {
    name:
      (meta.name as string | undefined) ??
      (meta.full_name as string | undefined) ??
      u.email.split("@")[0],
    email: u.email,
    picture: (meta.picture as string | undefined) ?? (meta.avatar_url as string | undefined),
    provider: provider === "google" ? "google" : "email",
    signedInAt: new Date().toISOString(),
  };
}
