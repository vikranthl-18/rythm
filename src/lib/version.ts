// ---------------------------------------------------------------------------
// Version + diagnostics — shown in Settings and embedded in the feedback
// report so testers can say "this happened on build X" without a backend.
// Bump APP_VERSION for every release (and keep package.json in sync).
// ---------------------------------------------------------------------------

export const APP_VERSION = "1.0.0";
export const APP_NAME = "rythm";

export function buildInfo(): string {
  return `${APP_NAME} v${APP_VERSION} · ${navigator.userAgent}`;
}

export function diagnosticInfo(): string {
  const lines = [
    `App: ${APP_NAME} v${APP_VERSION}`,
    `Origin: ${window.location.origin}`,
    `URL: ${window.location.href}`,
    `User agent: ${navigator.userAgent}`,
    `Screen: ${window.screen.width}x${window.screen.height} (dpr ${window.devicePixelRatio ?? 1})`,
    `Online: ${navigator.onLine ? "yes" : "no"}`,
    `SW: ${"serviceWorker" in navigator ? "supported" : "unsupported"}`,
  ];
  return lines.join("\n");
}

/** Build a mailto: link for the feedback button (env-configurable address). */
export function feedbackHref(): string {
  const to = (import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined) ?? "feedback@rythm.app";
  const subject = encodeURIComponent(`[${APP_NAME} v${APP_VERSION}] Feedback`);
  const body = encodeURIComponent(`${diagnosticInfo()}\n\n---\n\n`);
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
