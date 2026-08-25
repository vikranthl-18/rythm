// ---------------------------------------------------------------------------
// Client helper for the mail serverless function (api/mail.ts).
// Everything here is best-effort and fire-and-forget: a missing endpoint, a
// failed request or a rate limit never blocks or throws in the app.
// ---------------------------------------------------------------------------

export type MailKind = "welcome" | "weekly_digest" | "friend_request" | "milestone";

export async function sendEmail(
  kind: MailKind,
  payload: { to: string; name?: string; data?: Record<string, unknown> }
): Promise<void> {
  // Same-origin by default: the Vite dev server serves /api/mail (see
  // vite.config.ts) and Vercel deploys api/mail.ts to /api/mail. Set
  // VITE_MAIL_API to override (e.g. a dedicated function URL).
  const url = (import.meta.env.VITE_MAIL_API as string | undefined) || "/api/mail";
  if (!url || !payload.to) return;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = import.meta.env.VITE_MAIL_API_TOKEN as string | undefined;
    if (token) headers.authorization = `Bearer ${token}`;
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind, ...payload }),
    });
  } catch {
    /* best-effort — email never blocks the app */
  }
}
