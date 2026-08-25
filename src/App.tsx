import { useEffect, useRef, useState } from "react";
import { SIM_TICK_MS, useStore } from "./store";
import Dashboard from "./screens/Dashboard";
import Activity from "./screens/Activity";
import Habits from "./screens/Habits";
import Devices from "./screens/Devices";
import Coach from "./screens/Coach";
import Settings from "./screens/Settings";
import AuthScreen from "./screens/AuthScreen";
import Onboarding from "./screens/Onboarding";
import GpsPermissionSheet from "./components/GpsPermissionSheet";
import FeatureTour, { type TourSub } from "./components/FeatureTour";
import { gpsSupported } from "./lib/location";
import { applyCustomColors } from "./lib/palette";
import { authUserFromSession, supabase, supabaseAvailable } from "./lib/supabase";

export type Tab = "home" | "activity" | "habits" | "devices" | "coach" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "activity", label: "Activity", icon: "bolt" },
  { id: "habits", label: "Habits", icon: "grid" },
  { id: "devices", label: "Devices", icon: "watch" },
  { id: "coach", label: "Coach", icon: "chat" },
  { id: "settings", label: "Settings", icon: "gear" },
];

function NavIcon({ name }: { name: string }) {
  switch (name) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z" />
        </svg>
      );
    case "grid":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
        </svg>
      );
    case "watch":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2.5" width="10" height="19" rx="3" />
          <path d="M9.5 7.5h5M9.5 16.5h5" />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="M8.5 10.5h7M8.5 13.5h4.5" />
        </svg>
      );
    case "gear":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  // Which Activity sub-tab to land on (the tour jumps straight to Records /
  // Friends; the tab bar resets it back to Feed).
  const [activitySub, setActivitySub] = useState<TourSub>("feed");

  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);
  const greenColor = useStore((s) => s.greenColor);
  const auth = useStore((s) => s.auth);
  const onboarded = useStore((s) => s.onboarded);
  const profileRestoring = useStore((s) => s.profileRestoring);
  const tourSeen = useStore((s) => s.tourSeen);
  const gpsPermission = useStore((s) => s.gpsPermission);

  // All hooks run unconditionally so hook order never changes across the
  // auth gate (React error #310 otherwise).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // User-picked colors override the accent/sage token families (inline styles
  // on <html>, so they survive theme switches and clear on reset).
  useEffect(() => {
    applyCustomColors(accentColor, greenColor);
  }, [accentColor, greenColor]);

  // A fresh sign-in (gate → app) should land on Home, not a stale tab.
  const prevAuth = useRef(auth);
  useEffect(() => {
    if (prevAuth.current === null && auth !== null) setTab("home");
    prevAuth.current = auth;
  }, [auth]);

  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), SIM_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Geolocation is only ever touched AFTER the user granted permission — the
  // watcher starts here, and stops when permission is revoked or logged out.
  useEffect(() => {
    if (gpsPermission !== "granted" || !gpsSupported()) return;
    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (p) => useStore.getState().setGpsPos([p.coords.latitude, p.coords.longitude]),
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    } catch {
      /* geolocation unavailable — recording falls back to simulated GPS */
    }
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [gpsPermission]);

  // ---- Supabase auth (when configured) -------------------------------------
  // Restore a session on load and react to sign-in/sign-out events. Supabase
  // Auth does the OAuth handshake and verifies Google tokens server-side; we
  // just map the session onto the app's AuthUser and let the normal flow run.
  useEffect(() => {
    if (!supabaseAvailable || !supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const u = authUserFromSession(session);
        if (u) useStore.getState().setAuth(u);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const u = authUserFromSession(data.session);
        if (u) {
          const st = useStore.getState();
          st.setAuth(u);
          // Rehydrate from the cloud if this account opted into sync.
          if (st.syncEnabled) void st.syncNow();
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- Wearable data refresh ---------------------------------------------
  // The Health tab (native) pushes to health_samples whenever the user taps
  // Read. The App tab pulls on sign-in/launch — and here on a 60s heartbeat
  // + every time the tab becomes visible — so a fresh read shows up on the
  // dashboard without force-closing the app. No-op for demo accounts.
  useEffect(() => {
    if (!supabaseAvailable || !supabase) return;
    const pull = () => void useStore.getState().pullHealthSamples();
    pull();
    const id = setInterval(pull, 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ---- Opt-in cloud sync ---------------------------------------------------
  // Local-first default: nothing runs until the user enables sync in
  // Settings. When enabled: one sync on startup, a periodic heartbeat (the
  // sim ticks constantly, so a fixed interval is cheaper than a subscribe-
  // everything watcher), and per-action pushes after workouts/habits/etc.
  const syncEnabled = useStore((s) => s.syncEnabled);
  useEffect(() => {
    if (!syncEnabled || !supabaseAvailable) return;
    void useStore.getState().syncNow();
    const id = setInterval(() => {
      void useStore.getState().syncNow();
    }, 15 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void useStore.getState().syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncEnabled]);

  const go = (t: Tab, sub?: TourSub) => {
    setTab(t);
    setActivitySub(t === "activity" ? (sub ?? "feed") : "feed");
  };

  // Auth gate — the app is locked until you sign in / sign up (first open).
  if (!auth) {
    return (
      <div className="app">
        <main className="screen">
          <AuthScreen />
        </main>
      </div>
    );
  }

  // A returning Supabase account's profile is being fetched from the cloud so
  // first-run setup doesn't flash on a new device — hold the gate on a brief
  // restore screen (a genuine new account resolves to onboarding in ~1s).
  if (profileRestoring) {
    return (
      <div className="app">
        <main className="screen">
          <div className="restore-screen">
            <span className="logo auth-logo">◢</span>
            <p className="hint">Restoring your profile…</p>
          </div>
        </main>
      </div>
    );
  }

  // First-run onboarding — collect birthday/age, sex, weight, height & goal
  // before the app unlocks (they feed every metric and the AI coach).
  if (!onboarded) {
    return (
      <div className="app">
        <main className="screen">
          <Onboarding />
        </main>
      </div>
    );
  }

  // Explicit location consent — asked once, right after onboarding.
  const gpsPending = gpsPermission === "unknown" && gpsSupported();

  return (
    <div className="app">
      <main className="screen">
        {tab === "home" && <Dashboard onNavigate={go} />}
        {tab === "activity" && <Activity key={activitySub} initialTab={activitySub} />}
        {tab === "habits" && <Habits />}
        {tab === "devices" && <Devices />}
        {tab === "coach" && <Coach />}
        {tab === "settings" && <Settings />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => go(t.id)}
          >
            <NavIcon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {gpsPending && <GpsPermissionSheet />}
      {!tourSeen && !gpsPending && <FeatureTour onNavigate={go} />}
    </div>
  );
}
