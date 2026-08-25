// ---------------------------------------------------------------------------
// Global error capture — the last error powers the crash screen's "what went
// wrong" line and is included in the feedback report so testers can send
// something useful without a backend. Sentry (opt-in via VITE_SENTRY_DSN)
// receives the same errors when configured.
// ---------------------------------------------------------------------------

import { reportToSentry } from "./sentry";

export interface CapturedError {
  message: string;
  stack?: string;
  at: string;
}

const LAST_ERROR_KEY = "rythm-last-error";

let lastError: CapturedError | null = null;

export function captureError(e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  // Sentry (opt-in via VITE_SENTRY_DSN) gets the same error — the in-app
  // report below keeps working regardless.
  reportToSentry(e);
  lastError = {
    message: err.message || String(e),
    stack: err.stack,
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LAST_ERROR_KEY, JSON.stringify(lastError));
  } catch {
    /* storage unavailable — in-memory copy is enough */
  }
}

export function getLastError(): CapturedError | null {
  if (lastError) return lastError;
  try {
    const raw = localStorage.getItem(LAST_ERROR_KEY);
    if (!raw) return null;
    lastError = JSON.parse(raw) as CapturedError;
    return lastError;
  } catch {
    return null;
  }
}

export function clearLastError(): void {
  lastError = null;
  try {
    localStorage.removeItem(LAST_ERROR_KEY);
  } catch {
    /* ignore */
  }
}

/** Wire window-level error/unhandled-rejection capture; returns a cleanup fn. */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => captureError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => captureError(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
