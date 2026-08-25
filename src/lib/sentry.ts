// ---------------------------------------------------------------------------
// Sentry crash/error reporting (web). Opt-in: nothing is sent unless
// VITE_SENTRY_DSN is set in .env.local. The app's deterministic fallbacks
// (crash screen, in-app feedback report) keep working with or without it.
// ---------------------------------------------------------------------------

import * as Sentry from "@sentry/react";

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ?? "";

let enabled = false;

/** Initialise Sentry once, at app start (before any handler is installed). */
export function initSentry(): void {
  if (!DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.PROD ? "production" : "development",
      // The app is a single self-contained HTML file; PII-free breadcrumbs
      // are useful for reproducing crashes without leaking health data.
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // Health data is the moat — never send metric values, emails or
        // anything from the store. Errors carry stacks only.
        delete event.user;
        return event;
      },
    });
    enabled = true;
    console.info("rythm: Sentry enabled");
  } catch {
    // Sentry must never break the app — a bad DSN is a no-op.
  }
}

/** Forward a captured error to Sentry when configured (no-op otherwise). */
export function reportToSentry(error: unknown): void {
  if (!enabled) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureException(err);
  } catch {
    /* ignore — reporting must never throw */
  }
}
