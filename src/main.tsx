import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errors";
import { initSentry } from "./lib/sentry";
import { useStore } from "./store";
import "leaflet/dist/leaflet.css";
import "./theme.css";
import "./styles.css";

// Capture uncaught errors + rejections so the crash screen and the feedback
// report always have something concrete to show. Sentry (when a DSN is set)
// gets the same errors, so tester crashes reach you without breaking the
// local-first promise — the in-app report keeps working either way.
initSentry();
installGlobalErrorHandlers();

// Production-only service worker: the single-file build is fully self-contained
// in index.html, so one cached copy makes the whole app work offline.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* SW unavailable (e.g. file:// preview) — the app still works online */
    });
  });
}

// Apply saved theme before first paint to avoid a flash.
try {
  const saved = localStorage.getItem("rythm-theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
} catch {
  /* storage unavailable */
}

// The APK's native shell posts this after it auto-syncs Health Connect data —
// pull the fresh rows so the dashboard updates without a reload. This calls
// pullHealthSamples DIRECTLY (not the opt-in "Sync with cloud" button, which
// is gated on the user enabling snapshot sync) so a wearable push always
// reaches the dashboard regardless of that toggle.
(window as unknown as { __rythmPullHealth?: () => void }).__rythmPullHealth = () => {
  void useStore.getState().pullHealthSamples();
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
