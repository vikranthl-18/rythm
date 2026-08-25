// ---------------------------------------------------------------------------
// WebAppShell — the full rythm product inside the APK.
//
// The web app (13k+ lines: dashboard, workouts, habits, coach, friends,
// settings) is a tested PWA. Embedding it via WebView gives the native app
// the EXACT same look and function with zero divergence — it IS the same
// code. The native layer's job is what a browser can't do: HealthKit /
// Health Connect reads (see the Health tab in App.tsx).
//
// Loads EXPO_PUBLIC_WEB_URL (the deployed web app, e.g. Vercel). Until the
// web app is deployed, the shell shows a clear "point me at it" screen
// instead of a blank page.
//
// Single sign-in: the web app keeps its Supabase session in localStorage
// (key `sb-<project-ref>-auth-token`). This shell polls that key and posts
// the tokens to the native side via onSession, so the Health tab is signed
// in automatically with the same Google / email account — no second login.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { Session } from "@supabase/supabase-js";
import type { NativeOAuthOutcome } from "./oauth";
import { SUPABASE_URL } from "./sync";

/**
 * The deployed web app. A per-launch `?v=` cache-buster is appended so the
 * WebView never serves a stale bundle after a redeploy — every app launch
 * fetches the latest web build. (The single-file web app is ~900 KB, so this
 * is cheap; swap for a version-based scheme before a store release.)
 */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").trim() + `?v=${Date.now()}`;

export function webUrlConfigured(): boolean {
  return WEB_URL.length > 0;
}

/** Supabase session tokens, borrowed from the web app's localStorage. */
export interface SharedSession {
  access_token: string;
  refresh_token: string | null;
}

/**
 * localStorage key the web app's supabase-js uses to persist its session
 * (sb-<project-ref>-auth-token). Same format as the web app's own storage,
 * so a session written here unlocks the web app on its next load.
 */
function sessionStorageKey(): string | null {
  const m = SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/);
  return m ? `sb-${m[1]}-auth-token` : null;
}

/**
 * Reads the web app's Supabase session out of localStorage and posts it as
 * { __rythmSession: tokens | null }. Polled every few seconds so sign-in /
 * sign-out in the App tab propagates to the Health tab automatically.
 */
const SESSION_POLL_JS = `
(function () {
  try {
    var key = null;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) { key = k; break; }
    }
    var tok = null;
    if (key) {
      try {
        var p = JSON.parse(localStorage.getItem(key) || 'null');
        if (p && p.access_token) tok = { access_token: p.access_token, refresh_token: p.refresh_token || null };
      } catch (e) {}
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({ __rythmSession: tok }));
  } catch (e) {}
})();
true;
`;

interface Props {
  /** Called whenever the web app's Supabase session appears or disappears. */
  onSession?: (session: SharedSession | null) => void;
  /**
   * Increment to ask the web app to re-pull its cloud health samples (used
   * after the native auto-sync pushes new Health Connect data).
   */
  pullTick?: number;
  /**
   * Native Google sign-in (Chrome Custom Tab). Called when the web app asks
   * for it (its Google button detects it's inside the shell and posts
   * { __rythmOAuth: { type: "google" } } instead of doing browser OAuth).
   */
  onNativeGoogle?: () => Promise<NativeOAuthOutcome>;
  /**
   * A session won natively (e.g. the Health tab's Google button). Injected
   * into the WebView's localStorage so the App tab unlocks with it. The
   * injected JS self-guards: if the WebView already holds this token it's a
   * no-op, so re-injection never causes a reload loop.
   */
  injectSession?: Session | null;
}

/** JS that writes the session into the web app's localStorage and reloads. */
function injectSessionJs(key: string, session: Session): string {
  const sessionJson = JSON.stringify(session);
  return `(function(){ try {
    var cur = localStorage.getItem(${JSON.stringify(key)});
    if (cur) { try { var p = JSON.parse(cur); if (p && p.access_token === ${JSON.stringify(session.access_token)}) return; } catch (e) {} }
    localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(sessionJson)});
    location.reload();
  } catch (e) {} })(); true;`;
}

/** JS that tells the web app its native sign-in attempt failed. */
function oauthErrorJs(error: string): string {
  return `(function(){ try {
    if (window.__rythmOAuthDone) window.__rythmOAuthDone({ ok: false, error: ${JSON.stringify(error)} });
  } catch (e) {} })(); true;`;
}

/** JS that asks the web app to re-pull cloud health samples (registered by the web app as window.__rythmPullHealth). */
const PULL_HEALTH_JS = `(function(){ try {
  if (window.__rythmPullHealth) window.__rythmPullHealth();
} catch (e) {} })(); true;`;

export default function WebAppShell({ onSession, onNativeGoogle, injectSession, pullTick = 0 }: Props) {
  const [canGoBack, setCanGoBack] = useState(false);
  const [webRef, setWebRef] = useState<WebView | null>(null);
  const [webError, setWebError] = useState<string | null>(null);

  // Native Google sign-in requested from inside the web app: run the Custom
  // Tab flow, then either unlock the web app by injecting the session or
  // post the failure back so the web app can show it.
  const handleOAuthRequest = async (msg: { type?: string }) => {
    if (msg.type !== "google" || !onNativeGoogle) return;
    const res = await onNativeGoogle();
    const key = sessionStorageKey();
    if (res.ok && res.session && key) {
      webRef?.injectJavaScript(injectSessionJs(key, res.session));
    } else {
      webRef?.injectJavaScript(oauthErrorJs(res.error ?? "Google sign-in failed — try again."));
    }
  };

  useEffect(() => {
    if (!webUrlConfigured()) return;
    webRef?.injectJavaScript(SESSION_POLL_JS);
    const id = setInterval(() => webRef?.injectJavaScript(SESSION_POLL_JS), 4000);
    return () => clearInterval(id);
  }, [webRef]);

  // Push a natively-won session into the WebView so the App tab unlocks
  // (idempotent — the injected JS skips the reload when the token is already
  // in localStorage).
  useEffect(() => {
    if (!webUrlConfigured() || !injectSession || !webRef) return;
    const key = sessionStorageKey();
    if (key) webRef.injectJavaScript(injectSessionJs(key, injectSession));
  }, [injectSession, webRef]);

  // Native auto-sync pushed new data — tell the web app to pull it (fresh
  // dashboard numbers without a reload). Runs on mount too, which is a cheap
  // "already up to date" no-op for the web app.
  useEffect(() => {
    if (!webUrlConfigured() || !webRef) return;
    webRef.injectJavaScript(PULL_HEALTH_JS);
  }, [pullTick, webRef]);

  if (!webUrlConfigured()) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>◢ rythm</Text>
        <Text style={styles.note}>
          The app shell is ready, but it needs to know where your web app is hosted.
        </Text>
        <Text style={styles.note}>
          Deploy the web app (Vercel → the repo root), then set EXPO_PUBLIC_WEB_URL to its
          https:// URL in native/.env (and in eas.json preview.env) and rebuild.
        </Text>
        <Text style={styles.note}>
          Health reads still work from the Health tab below without it.
        </Text>
      </View>
    );
  }

  // A localhost / 127.0.0.1 web URL only works on the computer running that
  // server — from a phone, localhost is the phone itself and the load fails
  // with "This site can't be reached — localhost refused to connect". Say so
  // plainly instead of showing the cryptic Chromium error page.
  if (WEB_URL.startsWith("http://localhost") || WEB_URL.startsWith("http://127.0.0.1")) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>◢ rythm</Text>
        <Text style={styles.note}>
          EXPO_PUBLIC_WEB_URL is set to <Text style={styles.mono}>{WEB_URL}</Text> — a local
          address that only the computer running it can reach. Your phone can't.
        </Text>
        <Text style={styles.note}>
          Set it to your deployed https:// URL in native/.env and in eas.json →
          build.preview.env, then rebuild. The live app is at https://rythm-rythm7.vercel.app.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <WebView
        ref={setWebRef}
        source={{ uri: WEB_URL }}
        style={styles.fill}
        javaScriptEnabled
        domStorageEnabled
        // OAuth flows (Google account chooser) open a popup via window.open —
        // let the WebView open it instead of silently dropping it.
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        onNavigationStateChange={(nav: WebViewNavigation) => {
          setCanGoBack(nav.canGoBack);
          // A successful navigation clears any previous load error.
          if (nav.url && !nav.url.startsWith("https://accounts.google.com")) {
            setWebError(null);
          }
        }}
        onLoadEnd={() => webRef?.injectJavaScript(SESSION_POLL_JS)}
        onMessage={(e: WebViewMessageEvent) => {
          try {
            const data = JSON.parse(e.nativeEvent.data) as {
              __rythmSession?: SharedSession | null;
              __rythmOAuth?: { type?: string };
            };
            if (data && typeof data === "object" && "__rythmOAuth" in data) {
              void handleOAuthRequest(data.__rythmOAuth ?? {});
            } else if (data && typeof data === "object" && "__rythmSession" in data) {
              console.warn(
                `rythm: web session poll → ${data.__rythmSession ? "session found" : "none"}`
              );
              onSession?.(data.__rythmSession ?? null);
            }
          } catch {
            // Not one of our messages — ignore.
          }
        }}
        onShouldStartLoadWithRequest={(req) => {
          // Deep links out of the app (mailto:, tel:) go to the system.
          if (req.url.startsWith("mailto:") || req.url.startsWith("tel:")) {
            void Linking.openURL(req.url);
            return false;
          }
          return true;
        }}
        // geolocation: web app's GPS recording uses the browser geolocation API
        geolocationEnabled={Platform.OS === "android"}
        onError={(e) => {
          const desc = e.nativeEvent.description ?? String(e.nativeEvent.code ?? "");
          const failed = e.nativeEvent.url ?? "";
          console.warn("WebView error", desc, "code", e.nativeEvent.code, "url", failed);
          // Show load failures on screen — a silent WebView error looks like
          // a broken app. (Android codes are negative, e.g. -6 = connect
          // failure, -8 = timeout.) Include the URL that failed so the next
          // report tells us exactly what couldn't be reached.
          setWebError(`${desc}${failed ? ` — ${failed}` : ""}` || `Load failed (code ${e.nativeEvent.code ?? "?"}).`);
        }}
      />
      {webError && (
        <View style={styles.errBanner}>
          <Text style={styles.errText}>⚠ {webError}</Text>
          <TouchableOpacity
            style={styles.errBtn}
            onPress={() => {
              setWebError(null);
              webRef?.reload();
            }}
          >
            <Text style={styles.errBtnText}>Reload</Text>
          </TouchableOpacity>
        </View>
      )}
      {canGoBack && (
        <TouchableOpacity style={styles.backBtn} onPress={() => webRef?.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: "#f1dec4" },
  title: { fontSize: 22, fontWeight: "800", color: "#bd4444" },
  note: { marginTop: 10, color: "#6b6257", fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: "monospace", fontSize: 12, color: "#bd4444" },
  backBtn: {
    position: "absolute",
    left: 16,
    bottom: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(189,68,68,.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  errBanner: {
    position: "absolute",
    top: 40,
    left: 16,
    right: 16,
    backgroundColor: "#f5d9d9",
    borderRadius: 12,
    padding: 12,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  errText: { color: "#a33", fontSize: 12, lineHeight: 16, flex: 1 },
  errBtn: { marginLeft: 8, backgroundColor: "#bd4444", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  errBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
