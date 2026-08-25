// ---------------------------------------------------------------------------
// Sentry crash/error reporting (native). Opt-in: nothing is sent unless
// EXPO_PUBLIC_SENTRY_DSN is set in native/.env (and mirrored in eas.json
// preview.env for EAS builds). The app's own error UI keeps working without
// it, so a missing DSN is a silent no-op — never a crash.
// ---------------------------------------------------------------------------

import * as Sentry from "@sentry/react-native";

const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();

export function initSentry(): void {
  if (!DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      tracesSampleRate: 0.1,
    });
    console.info("rythm: Sentry enabled (native)");
  } catch {
    // A bad DSN must never break the app.
  }
}
