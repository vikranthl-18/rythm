// rythm native — the full product in an APK.
//
// Tab 1 "App":   the complete rythm web app (dashboard, workouts, habits,
//                coach, friends, settings) embedded via WebView — identical
//                look and function, same code, zero divergence.
// Tab 2 "Health":the native wearable bridge — reads the last 24h of HealthKit
//                / Health Connect data and syncs it to Supabase, where the
//                web app's priority-merge engine consumes it.
//
// Builds:
//   Android APK   → npx eas build -p android --profile preview
//   iOS TestFlight→ npx eas build -p ios --profile preview
// See native/README.md → "Build for testers".
//
// Env (native/.env, mirrored in eas.json preview.env):
//   EXPO_PUBLIC_WEB_URL          → deployed web app (e.g. https://rythm.vercel.app)
//   EXPO_PUBLIC_SUPABASE_URL     → same Supabase project as the web app
//   EXPO_PUBLIC_SUPABASE_ANON_KEY

import { useCallback, useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { isHealthKitAvailable, readHealthKit, requestHealthKitPermissions, healthKitSource } from "./src/healthkit";
import {
  healthConnectStatus,
  readHealthConnect,
  requestHealthConnectPermissions,
  healthConnectSource,
} from "./src/healthconnect";
import { bridgeToSamples } from "./src/bridge";
import {
  clearNativeSession, currentUserEmail, pushRecords, sessionState,
  setNativeSession, signInWithPassword, signOut, signUpWithPassword,
  supabaseConfigured,
} from "./src/sync";
import { signInWithGoogleNative, type NativeOAuthOutcome } from "./src/oauth";
import { useAutoSync } from "./src/autoSync";
import { initSentry } from "./src/sentry";
import NotificationsPanel from "./src/NotificationsPanel";
import type { MergeSample, NativeRecord } from "./src/types";
import WebAppShell, { webUrlConfigured, type SharedSession } from "./src/WebAppShell";

// Crash/error reporting — no-op unless EXPO_PUBLIC_SENTRY_DSN is baked in.
initSentry();

type Tab = "app" | "health";

interface Summary {
  hrAvg: number | null;
  restingHR: number | null;
  hrvAvg: number | null;
  steps: number;
  calories: number;
  sleepMin: number;
  sleepStages: { deep: number; light: number; rem: number; awake: number } | null;
  samples: number;
}

function summarize(records: NativeRecord[]): Summary {
  const hrs: number[] = [];
  let resting: number | null = null;
  const hrvs: number[] = [];
  let steps = 0;
  let calories = 0;
  let sleepMin = 0;
  let stages: Summary["sleepStages"] = null;
  for (const r of records) {
    if (r.type === "heartRate") hrs.push(r.value);
    else if (r.type === "restingHR") resting = r.value;
    else if (r.type === "hrv") hrvs.push(r.value);
    else if (r.type === "steps") steps += r.value;
    else if (r.type === "calories" || r.type === "activeEnergy") calories += r.value;
    else if (r.type === "sleep") {
      sleepMin += r.value;
      if (r.sleepStages) {
        stages = stages ?? { deep: 0, light: 0, rem: 0, awake: 0 };
        stages.deep += r.sleepStages.deepMin;
        stages.light += r.sleepStages.lightMin;
        stages.rem += r.sleepStages.remMin;
        stages.awake += r.sleepStages.awakeMin;
      }
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return {
    hrAvg: avg(hrs),
    restingHR: resting ? Math.round(resting) : null,
    hrvAvg: avg(hrvs),
    steps,
    calories: Math.round(calories),
    sleepMin,
    sleepStages: stages,
    samples: records.length,
  };
}

const fmtH = (min: number) => `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// How much history to read from the health platform. Daily/aggregate metrics
// (sleep, steps, HRV, resting HR, calories…) use the full range; continuous
// metrics like heart rate / SpO2 stay capped at 7 days inside the readers.
const RANGES = [
  { label: "24h", days: 1, prose: "24 hours" },
  { label: "7d", days: 7, prose: "7 days" },
  { label: "30d", days: 30, prose: "30 days" },
  { label: "Max", days: 90, prose: "90 days" },
] as const;

function HealthBridge({
  sharedEmail,
  onGoogleSignIn,
  onSignedOut,
  onHealthGranted,
}: {
  sharedEmail: string | null;
  onGoogleSignIn: () => Promise<NativeOAuthOutcome>;
  onSignedOut: () => void;
  /** Called right after Health Connect access is granted (triggers an immediate auto-sync). */
  onHealthGranted: () => void;
}) {
  const platform: "ios" | "android" | null =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [hcStatus, setHcStatus] = useState<string>("");
  const [diag, setDiag] = useState<string>("");
  const [records, setRecords] = useState<NativeRecord[]>([]);
  const [samples, setSamples] = useState<MergeSample[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  // Default to 30 days so a read actually fills history (sleep, steps, HRV,
  // resting HR…) instead of just today. Tap a chip to change it.
  const [rangeDays, setRangeDays] = useState(30);
  const rangeProse = RANGES.find((r) => r.days === rangeDays)?.prose ?? "24 hours";

  useEffect(() => {
    let alive = true;
    const checkSession = async () => {
      // The web app's session (shared via the App tab) wins; otherwise fall
      // back to a native email/password session.
      const emailNow = sharedEmail ?? (await currentUserEmail());
      if (alive) setSignedIn(Boolean(emailNow));
      const st = await sessionState();
      if (alive) setDiag(`adopted:${st.adopted ? "yes" : "no"} · native:${st.native ? "yes" : "no"}`);
    };
    void checkSession();
    // One-time platform status (Health Connect availability).
    if (platform === "android") {
      void healthConnectStatus().then((s) => {
        if (alive) setHcStatus(s);
      });
    }
    // Self-heal: the web session is adopted a moment after launch (the App
    // tab's WebView poll delivers it). Keep re-checking so the tab flips to
    // signed-in without a manual reload or tab switch.
    const id = setInterval(() => void checkSession(), 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [platform, sharedEmail]);

  const doAuth = useCallback(
    async (mode: "in" | "up") => {
      setAuthBusy(true);
      setAuthMsg(null);
      const res = mode === "in" ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
      setAuthBusy(false);
      if (res.ok) {
        if (mode === "up") {
          setAuthMsg(res.error ?? "Account created — confirm your email, then sign in.");
        } else {
          setSignedIn(true);
        }
      } else {
        setAuthMsg(res.error ?? "Something went wrong.");
      }
    },
    [email, password]
  );

  const source = platform === "ios" ? healthKitSource : healthConnectSource;

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSyncMsg(null);
    try {
      let recs: NativeRecord[] = [];
      if (platform === "ios") {
        if (!isHealthKitAvailable()) {
          setError("HealthKit is unavailable — run on an iPhone or a HealthKit-capable simulator.");
          return;
        }
        const granted = await requestHealthKitPermissions();
        if (!granted) {
          setError("HealthKit permission was declined. Enable it in Settings → Privacy → Health.");
          return;
        }
        recs = await readHealthKit(rangeDays);
      } else if (platform === "android") {
        if (hcStatus !== "available" && hcStatus !== "unknown") {
          setError("Health Connect isn't installed. Install it from the Play Store, then retry.");
          return;
        }
        const perm = await requestHealthConnectPermissions();
        if (!perm.ok) {
          if (perm.reason === "allowlist") {
            setError(`${perm.message}\n\nThis is a Google-side gate — the tester build needs the developer to finish the Health Connect declaration first.`);
          } else {
            setError(perm.message);
          }
          return;
        }
        onHealthGranted();
        recs = await readHealthConnect(rangeDays);
      } else {
        setError("Unsupported platform.");
        return;
      }
      setRecords(recs);
      setSamples(bridgeToSamples(recs, source));
      setSummary(summarize(recs));

      // Auto-sync: push what we just read so the web app's merge engine sees
      // it without a separate step. The manual button below stays as a retry.
      if (recs.length > 0) {
        const res = await pushRecords(recs, source);
        if (res.ok) {
          // Name the devices found (Health Connect data origins) so it's
          // obvious which devices actually contributed rows.
          const origins = [...new Set(recs.map((r) => r.origin).filter((o): o is string => !!o))];
          const devLabel = origins.length
            ? ` — devices: ${origins.map((o) => (o.split(".").pop() ?? o).toUpperCase()).join(", ")}`
            : "";
          setSyncMsg(`Read ${recs.length} records — synced ${res.pushed} batches to the cloud ✓${devLabel}`);
        } else {
          setSyncMsg(`Read OK, but sync needs attention: ${res.error}`);
        }
      } else {
        setSyncMsg(
          `No health data found in the last ${rangeProse.toLowerCase()} — nothing was synced. Check: 1) Health Connect app → App permissions → rythm → allow every data type, 2) your watch/ring app (Fit, qring, …) is actually writing to Health Connect, and 3) you read on the phone the watch is paired to. Sideloaded tester builds are also gated by Google until the Health Connect declaration is approved.`
        );
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const msg = err?.message ?? String(e);
      setError(err?.code === "PERMISSION_ERROR" ? `Health Connect permission error: ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  }, [platform, source, hcStatus, rangeDays]);

  const doSync = useCallback(async () => {
    setSyncBusy(true);
    setSyncMsg(null);
    const res = await pushRecords(records, source);
    setSyncBusy(false);
    setSyncMsg(res.ok ? `Synced ${res.pushed} metric-day batches to the cloud ✓` : res.error ?? "Sync failed.");
  }, [records, source]);

  if (signedIn === null) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color="#bd4444" style={{ marginTop: 48 }} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        <Text style={styles.title}>Health bridge</Text>
        <Text style={styles.sub}>
          {platform === "ios" ? "Apple HealthKit" : platform === "android" ? `Android Health Connect${hcStatus ? ` (${hcStatus})` : ""}` : "Unsupported platform"}
        </Text>
        <Text style={styles.note}>
          Sign in with the same account you use in the rythm app — your health data syncs to your own project.
        </Text>
        <Text style={styles.note}>
          Tip: open the App tab and sign in there — the Health tab follows automatically with the same account.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnGoogle]} onPress={() => void (async () => {
          setAuthBusy(true);
          setAuthMsg(null);
          const res = await onGoogleSignIn();
          setAuthBusy(false);
          if (res.ok) setSignedIn(true);
          else setAuthMsg(res.error ?? "Google sign-in failed.");
        })()} disabled={authBusy}>
          <Text style={styles.btnText}>{authBusy ? "Connecting…" : "Continue with Google"}</Text>
        </TouchableOpacity>
        <Text style={styles.orDivider}>or with email</Text>
        <TextInput style={styles.input} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
        {!supabaseConfigured && (
          <Text style={styles.error}>
            Supabase isn't configured — add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to native/.env.
          </Text>
        )}
        <TouchableOpacity style={styles.btn} onPress={() => doAuth("in")} disabled={authBusy}>
          <Text style={styles.btnText}>{authBusy ? "Signing in…" : "Sign in"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => doAuth("up")} disabled={authBusy}>
          <Text style={[styles.btnText, { color: "#bd4444" }]}>Create account</Text>
        </TouchableOpacity>
        {authMsg && <Text style={styles.error}>{authMsg}</Text>}
        <Text style={styles.diag}>debug · {diag || "checking…"}</Text>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Health bridge</Text>
      <Text style={styles.sub}>
        {platform === "ios" ? "Apple HealthKit" : platform === "android" ? `Android Health Connect${hcStatus ? ` (${hcStatus})` : ""}` : ""} · {source.deviceName}
      </Text>

      <TouchableOpacity style={styles.btn} onPress={load} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Reading…" : `Read last ${rangeProse.toLowerCase()} of health data`}</Text>
      </TouchableOpacity>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.days}
            style={[styles.rangeChip, rangeDays === r.days && styles.rangeChipOn]}
            onPress={() => setRangeDays(r.days)}
          >
            <Text style={[styles.rangeChipText, rangeDays === r.days && styles.rangeChipTextOn]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.rangeHint}>
        Sleep, steps, HRV and resting HR use the full range; heart rate & SpO2 stay capped at 7 days.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {busy && <ActivityIndicator style={{ marginTop: 16 }} />}

      {/* Notifications live outside the summary gate so they're reachable
          before the first health read. */}
      <NotificationsPanel />

      {summary && (
        <ScrollView style={styles.list}>
          <Text style={styles.h2}>Last {rangeProse}</Text>
          <Row label="Heart rate (avg)" value={summary.hrAvg != null ? `${summary.hrAvg} bpm` : "—"} />
          <Row label="Resting HR" value={summary.restingHR != null ? `${summary.restingHR} bpm` : "—"} />
          <Row label="HRV (avg)" value={summary.hrvAvg != null ? `${summary.hrvAvg} ms` : "—"} />
          <Row label="Steps" value={summary.steps.toLocaleString()} />
          <Row label="Calories" value={`${summary.calories} kcal`} />
          <Row label="Sleep" value={summary.sleepMin > 0 ? fmtH(summary.sleepMin) : "—"} />
          {summary.sleepStages && (
            <Row label="Stages" value={`deep ${fmtH(summary.sleepStages.deep)} · light ${fmtH(summary.sleepStages.light)} · rem ${fmtH(summary.sleepStages.rem)} · awake ${fmtH(summary.sleepStages.awake)}`} />
          )}
          <Row label="Records read" value={`${summary.samples}`} />

          <Text style={styles.h2}>Ready for the merge engine</Text>
          <Text style={styles.note}>
            {samples.length} samples → push them to the cloud so the web app's priority engine can use them, or feed
            them straight into src/engine/priority.ts.
          </Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: "#677e61" }]} onPress={doSync} disabled={syncBusy || records.length === 0}>
            <Text style={styles.btnText}>{syncBusy ? "Syncing…" : "Sync again (retry)"}</Text>
          </TouchableOpacity>
          {syncMsg && <Text style={syncMsg.includes("✓") ? styles.ok : styles.error}>{syncMsg}</Text>}

          {samples.slice(0, 120).map((s, i) => (
            <Text key={i} style={styles.rowMono}>
              {s.deviceId} · {s.metric} · t={s.t} · {s.value}
            </Text>
          ))}

          {sharedEmail ? (
            <Text style={[styles.note, { marginTop: 16, fontWeight: "600", color: "#677e61" }]}>
              Signed in as {sharedEmail} via the App tab — sign out from the App tab.
            </Text>
          ) : (
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost, { marginTop: 16 }]}
              onPress={() =>
                void signOut().then(() => {
                  setSignedIn(false);
                  onSignedOut();
                })
              }
            >
              <Text style={[styles.btnText, { color: "#bd4444" }]}>Sign out</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// The web URL baked into THIS build. Shown on-screen (build stamp below the
// tabs) so an installed APK can be identified at a glance — the exact thing
// that has been impossible to verify so far and caused the localhost loop.
const BAKED_WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "").trim();

function BuildStamp() {
  const bad =
    !BAKED_WEB_URL ||
    BAKED_WEB_URL.startsWith("http://localhost") ||
    BAKED_WEB_URL.startsWith("http://127.0.0.1");
  // nativeBuildVersion = Android versionCode (unique per EAS build with
  // appVersionSource remote) — lets us tell builds apart instantly.
  const buildId = Constants.nativeBuildVersion ?? Constants.expoConfig?.version ?? "?";
  return (
    <View style={[styles.stampBar, bad && styles.stampBarBad]}>
      <Text style={styles.stampText} numberOfLines={1}>
        rythm build {buildId} · {Constants.executionEnvironment} · web: {BAKED_WEB_URL || "(unset)"}
      </Text>
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("app");
  const [sharedEmail, setSharedEmail] = useState<string | null>(null);
  const [injectedSession, setInjectedSession] = useState<import("@supabase/supabase-js").Session | null>(null);
  const lastSession = useRef<string>("");
  // True once a web session has been adopted. Used so a null poll only ever
  // drops the ADOPTED session — never a native email/password session the
  // user established independently on the Health tab.
  const hadAdoptedRef = useRef(false);

  // Health Connect → cloud, automatically. Runs at launch, on every
  // foreground, and every 15 min while open; see src/autoSync.ts.
  const [pullTick, setPullTick] = useState(0);
  // Bumped when the user grants Health Connect access on the Health tab —
  // auto-sync runs immediately on that instead of waiting for its retry.
  const [healthGrantedTick, setHealthGrantedTick] = useState(0);
  const autoStatus = useAutoSync(sharedEmail, healthGrantedTick);
  useEffect(() => {
    // A push landed — tell the App tab's web app to re-pull so the dashboard
    // shows fresh numbers without a manual reload.
    if (autoStatus.pushed) setPullTick((t) => t + 1);
  }, [autoStatus.pushed]);

  // Single sign-in: adopt the web app's Supabase session so the Health tab
  // is signed in with the same account. Dedupes by token so the 4s poller
  // doesn't re-adopt the same session on every tick.
  const handleSession = useCallback(async (session: SharedSession | null) => {
    const sig = session ? `${session.access_token.slice(0, 16)}|${session.refresh_token ?? ""}` : "none";
    if (sig === lastSession.current) return;
    lastSession.current = sig;
    if (session) {
      hadAdoptedRef.current = true;
      await setNativeSession(session.access_token, session.refresh_token);
      console.warn("rythm: adopted web session for Health tab");
    } else {
      // The web app signed out — drop the ADOPTED session and any injected
      // one, but never a native email/password session (it's independent).
      if (hadAdoptedRef.current) {
        hadAdoptedRef.current = false;
        await clearNativeSession();
      }
      setInjectedSession(null);
      console.warn("rythm: no web session");
    }
    setSharedEmail(await currentUserEmail());
  }, []);

  // Native Google sign-in (Custom Tab). Used by both the App tab (the web
  // app asks for it via postMessage) and the Health tab's own button. On
  // success the session is adopted here, shared with the Health tab, and
  // injected into the App tab's WebView so the web app unlocks.
  const handleNativeGoogle = useCallback(async (): Promise<NativeOAuthOutcome> => {
    const res = await signInWithGoogleNative();
    if (res.ok && res.session) {
      await setNativeSession(res.session.access_token, res.session.refresh_token ?? null);
      setSharedEmail(res.session.user.email ?? null);
      setInjectedSession(res.session);
    }
    return res;
  }, []);

  return (
    <View style={styles.app}>
      <View style={styles.content}>
        {/* BOTH tabs stay mounted; the inactive one is hidden (display:none).
            Unmounting the App tab's WebView stopped its session poll, so the
            Health tab could never learn the session was signed in, and every
            tab switch force-reloaded the whole web app (slow + re-ran the
            session restore). Hidden, the WebView keeps polling and keeps its
            session fresh. */}
        <View style={[styles.fill, tab !== "app" && styles.hiddenView]}>
          <WebAppShell
            onSession={handleSession}
            onNativeGoogle={handleNativeGoogle}
            injectSession={injectedSession}
            pullTick={pullTick}
          />
        </View>
        <View style={[styles.fill, tab !== "health" && styles.hiddenView]}>
          <HealthBridge
            sharedEmail={sharedEmail}
            onGoogleSignIn={handleNativeGoogle}
            onSignedOut={() => {
              setInjectedSession(null);
              setSharedEmail(null);
            }}
            onHealthGranted={() => setHealthGrantedTick((t) => t + 1)}
          />
        </View>
      </View>
      <BuildStamp />
      {autoStatus.text ? (
        <View style={[styles.autobar, autoStatus.state === "error" && styles.autobarError]}>
          <Text
            style={[styles.autobarText, autoStatus.state === "error" && { color: "#a33" }]}
            numberOfLines={1}
          >
            {autoStatus.text}
          </Text>
        </View>
      ) : null}
      <View style={styles.tabbar}>
        <TouchableOpacity style={[styles.tab, tab === "app" && styles.tabActive]} onPress={() => setTab("app")}>
          <Text style={[styles.tabText, tab === "app" && styles.tabTextActive]}>App</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === "health" && styles.tabActive]} onPress={() => setTab("health")}>
          <Text style={[styles.tabText, tab === "health" && styles.tabTextActive]}>Health</Text>
        </TouchableOpacity>
      </View>
      {!webUrlConfigured() && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>⚠ App tab needs EXPO_PUBLIC_WEB_URL — see the Health tab for details</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#f1dec4" },
  content: { flex: 1 },
  fill: { flex: 1 },
  hiddenView: { display: "none" },
  diag: { marginTop: 24, color: "#b0a79b", fontSize: 11, fontFamily: "monospace" },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,.1)",
    backgroundColor: "#fff",
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { backgroundColor: "#f1dec4" },
  tabText: { color: "#8a8177", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#bd4444", fontWeight: "800" },
  banner: { backgroundColor: "#f5d9d9", paddingVertical: 6, alignItems: "center" },
  bannerText: { color: "#a33", fontSize: 12 },
  stampBar: { backgroundColor: "#e8d9bd", paddingVertical: 3, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,.08)" },
  stampBarBad: { backgroundColor: "#f5d9d9" },
  stampText: { fontSize: 10, color: "#6b6257", fontFamily: "monospace" },
  autobar: { backgroundColor: "#dfe8d8", paddingVertical: 4, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,.06)" },
  autobarError: { backgroundColor: "#f5d9d9" },
  autobarText: { fontSize: 11, color: "#3f6b37", fontWeight: "600" },
  wrap: { flex: 1, padding: 24, paddingTop: 40, backgroundColor: "#f1dec4" },
  title: { fontSize: 22, fontWeight: "800", color: "#bd4444" },
  sub: { marginTop: 4, color: "#6b6257" },
  note: { marginTop: 10, color: "#6b6257", fontSize: 13, lineHeight: 18 },
  input: { marginTop: 12, backgroundColor: "#fff", borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1, borderColor: "rgba(0,0,0,.08)" },
  btn: { marginTop: 14, backgroundColor: "#bd4444", padding: 14, borderRadius: 12, alignItems: "center" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#bd4444" },
  btnGoogle: { backgroundColor: "#4285f4" },
  orDivider: { marginTop: 16, color: "#8a8177", fontSize: 12, textAlign: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  rangeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  rangeChip: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(0,0,0,.1)", alignItems: "center" },
  rangeChipOn: { backgroundColor: "#677e61", borderColor: "#677e61" },
  rangeChipText: { color: "#6b6257", fontWeight: "700", fontSize: 13 },
  rangeChipTextOn: { color: "#fff" },
  rangeHint: { marginTop: 8, color: "#8a8177", fontSize: 11, lineHeight: 15 },
  error: { marginTop: 10, color: "#a33", fontWeight: "600", fontSize: 13 },
  ok: { marginTop: 10, color: "#3f6b37", fontWeight: "600", fontSize: 13 },
  list: { marginTop: 12, flex: 1 },
  h2: { fontWeight: "800", color: "#677e61", marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,.06)" },
  rowLabel: { color: "#3b3229" },
  rowValue: { color: "#3b3229", fontWeight: "700", flexShrink: 1, textAlign: "right" },
  rowMono: { fontFamily: "monospace", fontSize: 11, color: "#6b6257", paddingVertical: 2 },
});
