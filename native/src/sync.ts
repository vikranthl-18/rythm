// ---------------------------------------------------------------------------
// Native ↔ Supabase sync for the tester build.
//
// Reads from HealthKit / Health Connect, then pushes per-day sample batches
// to the health_samples table (migration 0003). The web app can pull the
// same rows and feed them into the priority-merge engine — this is the
// real-device data path the web app's sim currently stands in for.
//
// Env: EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY (same project
// as the web app). Put them in native/.env — Expo embeds EXPO_PUBLIC_* vars
// at build time. The anon key is public by design; RLS keeps each user to
// their own rows.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import type { MergeSample, NativeRecord, NativeSource } from "./types";
import { RECORD_METRIC } from "./bridge";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = SUPABASE_URL.trim().length > 0 && SUPABASE_ANON_KEY.trim().length > 0;

export const nativeSupabase = supabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export interface SyncOutcome {
  ok: boolean;
  error?: string;
  pushed?: number;
}

// ---------------------------------------------------------------------------
// Session ownership. The WEB app (inside the WebView) is the real owner of
// the user's session: its supabase-js refreshes the access token and rotates
// the single-use refresh token when it does. The native side must therefore
// NEVER call supabase-js auth methods (getSession/setSession) with the web
// app's tokens — an auto-refresh there would rotate the shared refresh token
// and invalidate the web app's copy, so the next launch fails to restore and
// the user gets signed out. Instead we hold the tokens READ-ONLY and call
// Supabase's REST API directly with the current access token. The only native
// client session is the Health tab's own email/password login, which owns a
// separate refresh token nobody else touches.
// ---------------------------------------------------------------------------

let adopted: { access: string; email: string | null } | null = null;

/** Decode the email from a JWT (used to know who's signed in without refreshing). */
function emailFromToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json?.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/** Raw Supabase REST call with the CURRENT access token — never refreshes. */
async function authedFetch(path: string, init: RequestInit = {}, token: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function signInWithPassword(email: string, password: string): Promise<SyncOutcome> {
  if (!nativeSupabase) return { ok: false, error: "Supabase isn't configured — add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to native/.env." };
  const { error } = await nativeSupabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signUpWithPassword(email: string, password: string): Promise<SyncOutcome> {
  if (!nativeSupabase) return { ok: false, error: "Supabase isn't configured — add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to native/.env." };
  const { error } = await nativeSupabase.auth.signUp({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true, error: "Check your email to confirm, then sign in." };
}

export async function signOut(): Promise<void> {
  adopted = null;
  await nativeSupabase?.auth.signOut();
}

/**
 * Adopt the web app's Supabase tokens (single sign-in across tabs). The App
 * tab's WebView posts them from localStorage; the Health tab uses the same
 * Google / email account without a second login. Tokens are stored READ-ONLY
 * — the web app owns the session and its refresh cycle.
 */
export async function setNativeSession(accessToken: string, refreshToken: string | null): Promise<void> {
  adopted = { access: accessToken, email: emailFromToken(accessToken) };
}

/**
 * Drop the ADOPTED web session when the web app signs out. Deliberately does
 * NOT sign out the native email/password session — that one is independent
 * (the Health tab's own login) and must survive a web-side sign-out.
 */
export async function clearNativeSession(): Promise<void> {
  adopted = null;
}

export async function currentUserEmail(): Promise<string | null> {
  // Adopted web session wins (it's the live session in the App tab).
  if (adopted) return adopted.email;
  if (!nativeSupabase) return null;
  const { data } = await nativeSupabase.auth.getSession();
  return data?.session?.user.email ?? null;
}

/** Native-side session diagnostics (shown on the Health sign-in screen so a
 * report tells us exactly which link in the chain is missing). The native
 * client's getSession only ever reflects the Health tab's OWN email/password
 * session — web tokens are never set on it, so this can't rotate anything. */
export async function sessionState(): Promise<{ adopted: boolean; native: boolean }> {
  let native = false;
  if (nativeSupabase) {
    try {
      const { data } = await nativeSupabase.auth.getSession();
      native = Boolean(data.session);
    } catch {
      /* ignore */
    }
  }
  return { adopted: adopted !== null, native };
}

/** Local YYYY-MM-DD for an ISO timestamp. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The device slot key a record belongs to: Health Connect records carry the
 * writing app's package (data origin), so the watch (Fit) and the ring (its
 * app) become SEPARATE slots — the web app's Devices tab shows both, and
 * its priority engine picks ONE device per metric per day instead of summing
 * the same physical steps twice. Legacy flat rows used the bare device id;
 * the web app skips those after the first per-origin read.
 */
function sourceKeyFor(r: NativeRecord, source: NativeSource): string {
  if (source.kind === "healthkit") return source.deviceId;
  return r.origin ? `hc:${r.origin}` : "hc:unknown";
}

/** Convert records to samples with their original dates (for grouping). */
function samplesByDate(
  records: NativeRecord[],
  source: NativeSource
): Map<string, Map<string, Map<string, MergeSample[]>>> {
  const out = new Map<string, Map<string, Map<string, MergeSample[]>>>();
  // Per-date sleep-session counter — used to space sleep clusters apart so
  // multiple sessions in one day can never collide in the web decode.
  const sleepSeen = new Map<string, number>();
  for (const r of records) {
    // A night's sleep is labelled by the morning it ends (the day you wake
    // up) — matching the watch/Whoop convention, so "last night" shows on
    // today instead of looking like a missing day. Every other metric is
    // labelled by when it started.
    const ref = r.type === "sleep" ? r.end : r.start;
    const date = localDateKey(ref);
    const metric = RECORD_METRIC[r.type];
    const srcKey = sourceKeyFor(r, source);
    let byMetric = out.get(date);
    if (!byMetric) {
      byMetric = new Map();
      out.set(date, byMetric);
    }
    let bySrc = byMetric.get(metric);
    if (!bySrc) {
      bySrc = new Map();
      byMetric.set(metric, bySrc);
    }
    let list = bySrc.get(srcKey);
    if (!list) {
      list = [];
      bySrc.set(srcKey, list);
    }
    // t = minutes since local midnight of the labelling reference.
    const d = new Date(ref);
    const t = d.getHours() * 60 + d.getMinutes();
    if (r.type === "sleep" && r.sleepStages) {
      const { deepMin, lightMin, remMin, awakeMin } = r.sleepStages;
      // Time ASLEEP (deep + light + REM). Awake minutes ride along in the
      // stage samples but are NOT part of the duration the app displays —
      // it must match what the watch shows (asleep, excluding awake).
      const total = deepMin + lightMin + remMin;
      // Space each session's cluster apart (seq * 10000) so two sessions in
      // one day — a watch AND a ring writing the same night, or a nap — can
      // never merge into one contiguous cluster and silently drop data when
      // the web app decodes them.
      const seq = sleepSeen.get(date) ?? 0;
      sleepSeen.set(date, seq + 1);
      const base = seq * 10000 + t;
      list.push({ deviceId: srcKey, metric, t: base, value: total });
      list.push({ deviceId: srcKey, metric, t: base + 1, value: deepMin });
      list.push({ deviceId: srcKey, metric, t: base + 2, value: remMin });
      list.push({ deviceId: srcKey, metric, t: base + 3, value: lightMin });
      list.push({ deviceId: srcKey, metric, t: base + 4, value: awakeMin });
    } else {
      list.push({ deviceId: srcKey, metric, t, value: r.value });
    }
  }
  return out;
}

/**
 * Push a batch of records (grouped by day/metric) to Supabase. Returns how
 * many (date, metric) batches were written. Idempotent: upserts per key.
 * Uses the ADOPTED web token when present (raw REST — no refresh), and falls
 * back to the native email/password session otherwise.
 */
export async function pushRecords(records: NativeRecord[], source: NativeSource): Promise<SyncOutcome> {
  const byDate = samplesByDate(records, source);

  const runRpc = async (rpc: (p: unknown) => PromiseLike<{ error?: { message?: string } | null }>): Promise<SyncOutcome> => {
    let pushed = 0;
    for (const [date, byMetric] of byDate) {
      for (const [metric, bySrc] of byMetric) {
        for (const [srcKey, samples] of bySrc) {
          const { error } = await rpc({
            p_date: date,
            p_source: srcKey,
            p_metric: metric,
            p_samples: samples.map((s) => ({ t: s.t, value: s.value })),
          });
          if (error) {
            const msg = error.message ?? String(error);
            if (msg.includes("PGRST202") || msg.toLowerCase().includes("could not find the function")) {
              return {
                ok: false,
                error:
                  "The health_samples table isn't set up in your Supabase project yet. Open Supabase → SQL Editor and run supabase/migrations/0003_health_samples.sql, then tap Read + sync again.",
              };
            }
            return { ok: false, error: msg };
          }
          pushed++;
        }
      }
    }
    return { ok: true, pushed };
  };

  // Adopted web session: raw REST with the current access token (never
  // refresh — that would rotate the token the web app is holding).
  if (adopted) {
    try {
      return await runRpc(async (p) => {
        const res = await authedFetch(`/rest/v1/rpc/upsert_health_samples`, { method: "POST", body: JSON.stringify(p) }, adopted!.access);
        if (!res.ok) {
          const text = await res.text();
          return { error: { message: text.slice(0, 400) || `HTTP ${res.status}` } };
        }
        return {};
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A 401 means the access token expired between polls — the next poll
      // (4s) carries a fresh one, so this is transient, not a sign-out.
      return { ok: false, error: /401|JWT|token/i.test(msg) ? `Session token expired (transient — retrying on next sync): ${msg}` : msg };
    }
  }

  if (!nativeSupabase) return { ok: false, error: "Supabase isn't configured — add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to native/.env." };
  const { data } = await nativeSupabase.auth.getSession();
  if (!data.session) return { ok: false, error: "Not signed in — use the same account you sign into rythm with." };
  return runRpc((p) => nativeSupabase.rpc("upsert_health_samples", p));
}

/** Pull a day's samples back (what the web app would consume). */
export async function fetchSamples(date: string, source: string, metric: string): Promise<MergeSample[]> {
  if (adopted) {
    try {
      const res = await authedFetch(
        `/rest/v1/health_samples?select=samples&date=eq.${encodeURIComponent(date)}&source=eq.${encodeURIComponent(source)}&metric=eq.${encodeURIComponent(metric)}`,
        { method: "GET" },
        adopted.access
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as { samples: { t: number; value: number }[] }[];
      const raw = rows[0]?.samples ?? [];
      return raw.map((s) => ({ deviceId: source, metric: metric as MergeSample["metric"], t: s.t, value: s.value }));
    } catch {
      return [];
    }
  }
  if (!nativeSupabase) return [];
  const { data } = await nativeSupabase.auth.getSession();
  if (!data.session) return [];
  const { data: rows, error } = await nativeSupabase
    .from("health_samples")
    .select("samples")
    .eq("date", date)
    .eq("source", source)
    .eq("metric", metric)
    .maybeSingle();
  if (error || !rows) return [];
  const raw = rows.samples as { t: number; value: number }[];
  return raw.map((s) => ({ deviceId: source, metric: metric as MergeSample["metric"], t: s.t, value: s.value }));
}
