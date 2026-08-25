// ---------------------------------------------------------------------------
// Native Google sign-in (Chrome Custom Tabs + Supabase PKCE).
//
// Why this exists: the App tab is a WebView, and Google refuses sign-in
// inside embedded WebViews (connection errors, "disallowed_useragent") and
// cannot see the phone's Google accounts. This flow opens Google's real
// sign-in page in a Chrome Custom Tab instead — the same browser the user
// is signed into — then exchanges the PKCE code with Supabase and hands the
// session back. The session is injected into the WebView (WebAppShell) so
// the web app unlocks, and adopted by the native client so the Health tab
// is signed in too.
//
// Redirect URI: rythm://auth (custom scheme, declared in app.json). This
// works in the standalone APK; in Expo Go the redirect is exp://... and the
// flow falls back gracefully (Expo Go still opens Custom Tabs).
// ---------------------------------------------------------------------------

import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, setNativeSession, supabaseConfigured } from "./sync";

const REDIRECT_PATH = "auth";

/**
 * The URL Google redirects back to after sign-in. Must be a deep link the
 * installed app actually handles:
 *   - Standalone APK / dev build: `<scheme>://auth` (the scheme declared in
 *     app.json — canonical double-slash form; verified Supabase accepts it).
 *   - Expo Go: `exp://<metro-host>/--/auth`.
 *
 * We build it explicitly instead of using Linking.createURL() so the APK
 * always gets `rythm://auth` (createURL produces `rythm:///auth` — triple
 * slash — which works but is non-standard) and Expo Go gets the reachable
 * exp:// host instead of a guess.
 */
function buildRedirectUri(path: string): string {
  const scheme = Constants.expoConfig?.scheme;
  if (scheme && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
    return `${scheme}://${path}`;
  }
  // Expo Go (store client): the redirect must be exp://<host>/--/<path>.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    if (hostUri.startsWith("localhost") || hostUri.startsWith("127.0.0.1")) {
      console.warn(
        `rythm: Expo Go's Metro host is ${hostUri} — a physical phone cannot reach \"localhost\" (it means the phone itself). ` +
          `Google sign-in needs the LAN address (restart with \"npx expo start\" and scan the QR code) or the deployed APK.`
      );
    }
    return `exp://${hostUri}/--/${path}`;
  }
  throw new Error("rythm: cannot build an OAuth redirect URI for this environment (no app scheme and no Expo host).");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url (no padding) of arbitrary bytes — PKCE verifier. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

/** SHA-256 base64url (no padding) — PKCE code challenge. */
async function sha256Base64Url(input: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return hex.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export interface NativeOAuthOutcome {
  ok: boolean;
  error?: string;
  /** Full Supabase session (includes user) when successful. */
  session?: Session;
}

/**
 * Open Google's sign-in page in a Chrome Custom Tab (real browser — shows the
 * phone's accounts, no WebView blocking), then exchange the PKCE code with
 * Supabase. On success the session is adopted by the native client and
 * returned so the caller can inject it into the App tab's WebView.
 */
export async function signInWithGoogleNative(): Promise<NativeOAuthOutcome> {
  if (!supabaseConfigured) {
    return {
      ok: false,
      error: "Supabase isn't configured — add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to native/.env.",
    };
  }
  try {
    const redirectUri = buildRedirectUri(REDIRECT_PATH);
    const verifier = bytesToBase64Url(await Crypto.getRandomBytesAsync(48)); // 64 chars
    const challenge = await sha256Base64Url(verifier);

    const authUrl =
      `${SUPABASE_URL}/auth/v1/authorize?` +
      `provider=google&` +
      `redirect_to=${encodeURIComponent(redirectUri)}&` +
      `code_challenge=${encodeURIComponent(challenge)}&` +
      `code_challenge_method=S256&` +
      `scope=email%20profile`;
    console.warn(`rythm: opening Google auth → ${authUrl}`);

    // Watchdog: if Supabase's redirect URLs don't include rythm://auth, the
    // browser never comes back to the app (it lands on Supabase's default
    // http://localhost:3000 and shows "This site can't be reached"). Without a
    // timeout the app would wait forever — surface the real cause instead.
    const result = await Promise.race([
      WebBrowser.openAuthSessionAsync(authUrl, redirectUri),
      new Promise<{ type: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ type: "timeout" }), 90_000)
      ),
    ]);
    const REDIRECT_FIX_HINT =
      "If you saw a \"This site can't be reached\" / \"localhost refused to connect\" page after picking your account, Supabase redirected to its default address because the app's deep link isn't allowlisted. Fix: Supabase → Authentication → URL Configuration → add rythm://auth to Redirect URLs → Save → try again.";
    if (result.type === "timeout") {
      return { ok: false, error: `Sign-in took too long and didn't return to the app. ${REDIRECT_FIX_HINT}` };
    }
    if (result.type !== "success" || !result.url) {
      return {
        ok: false,
        error:
          result.type === "cancel" || result.type === "dismiss"
            ? `Sign-in was cancelled. ${REDIRECT_FIX_HINT}`
            : "Sign-in didn't complete — try again.",
      };
    }

    // The Custom Tab redirects back to rythm://auth?code=... (or carries
    // error params when the handshake failed).
    const url = new URL(result.url);
    // A redirect back to a localhost address means the app was pointed at a
    // local dev server — reachable only from the machine running it. On a
    // phone this fails with "localhost refused to connect". Catch it early
    // and say so instead of letting the user stare at a Chromium error page.
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return {
        ok: false,
        error:
          `Google redirected back to ${url.origin} — a local address that only works on the computer running it. ` +
          `The APK must load the deployed web app (set EXPO_PUBLIC_WEB_URL to https://… and rebuild); local dev servers can't be reached from a phone.`,
      };
    }
    const code = url.searchParams.get("code");
    if (!code) {
      const detail =
        url.searchParams.get("error_description") ||
        url.searchParams.get("error") ||
        "No auth code returned.";
      return { ok: false, error: detail };
    }

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier, redirect_to: redirectUri }),
    });
    const data = (await res.json()) as {
      // GoTrue returns the session FLAT at the top level (access_token,
      // refresh_token, user, …) — there is no `session` wrapper in the raw
      // response. supabase-js wraps it internally; our raw fetch must not.
      access_token?: string;
      refresh_token?: string | null;
      user?: unknown;
      msg?: string;
      error?: unknown;
      error_description?: string;
      error_code?: string;
    };
    if (!res.ok) {
      const raw =
        data.msg ||
        data.error_description ||
        (typeof data.error === "string" ? data.error : "") ||
        (data.error_code ? `Sign-in failed: ${data.error_code}` : `Sign-in failed (${res.status}).`);
      const m = raw.toLowerCase();
      if (m.includes("identity_already_exists") || m.includes("already linked to another")) {
        return {
          ok: false,
          error:
            "This Google account's email already has a rythm account with a password — sign in with that email and password instead, or use a different Google account.",
        };
      }
      return { ok: false, error: raw };
    }
    // Accept both shapes: the flat session GoTrue actually returns, or a
    // wrapped `{ session }` if Supabase ever changes the shape. This was the
    // "Sign in failed (200)" bug — a successful exchange was misread as a
    // failure because `data.session` never exists on the raw response.
    const session = data.access_token
      ? (data as unknown as Session)
      : (data as { session?: Session }).session ?? null;
    if (!session) {
      console.warn("rythm: token exchange returned 200 without a session", JSON.stringify(data).slice(0, 300));
      return { ok: false, error: "Sign-in failed — Supabase returned an empty response. Try again." };
    }

    await setNativeSession(session.access_token, session.refresh_token ?? null);
    return { ok: true, session };
  } catch (e) {
    return { ok: false, error: `Google sign-in failed: ${String(e)}` };
  }
}
