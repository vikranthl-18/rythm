// ---------------------------------------------------------------------------
// rythm — serverless transactional email endpoint
//
// Sends transactional emails (welcome, weekly digest, friend requests, PR
// milestones) via Resend (https://resend.com — free tier covers a public
// beta). Deploys as a Vercel Function alongside api/coach.ts; only uses the
// Web Request/Response API + fetch, so it ports to Netlify/Workers verbatim.
//
// Env vars (set on the platform, never in the client bundle):
//   RESEND_API_KEY    required — from https://resend.com/api-keys
//   MAIL_FROM         optional — verified sender, e.g. "rythm <hi@your-app.com>"
//                     (defaults to Resend's sandbox sender "onboarding@resend.dev",
//                     which only sends to your own verified address until you
//                     verify a domain)
//   MAIL_API_TOKEN    optional bearer token — if set, the app must send it
//
// Request body:
//   { kind: "welcome" | "weekly_digest" | "friend_request" | "milestone",
//     to: string, name?: string, data?: Record<string, unknown> }
// Response:
//   { ok: true } (200)  |  { error: string } (4xx/5xx)
// ---------------------------------------------------------------------------

export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

interface MailBody {
  kind?: string;
  to?: string;
  name?: string;
  data?: Record<string, unknown>;
}

const KIND_SUBJECTS: Record<string, string> = {
  welcome: "Welcome to rythm 🏃",
  weekly_digest: "Your rythm week, reviewed",
  friend_request: "Someone wants to train with you 👋",
  milestone: "New personal record on rythm 🎉",
};

/** Coarse per-recipient rate limit so a stuck client can't blow the quota. */
const lastSent = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBody(kind: string, name: string, data: Record<string, unknown>): string {
  const hi = name ? `Hi ${esc(name)},` : "Hi,";
  if (kind === "welcome") {
    const goal = data.goal ? esc(data.goal) : "your goal";
    return `${hi}
      <p>Welcome to <b>rythm</b> — your recovery, training and habits in one place.</p>
      <p>We've tuned every engine to you and your goal: <b>${goal}</b>. Give it a few days to
      learn your baselines, then the Rythm Score, recovery and AI coach go to work.</p>
      <ul>
        <li>💠 <b>Rythm Score</b> — your signature metric, on the Home tab</li>
        <li>🏃 <b>Record a run</b> — GPS routes + personal records in Activity</li>
        <li>🤖 <b>AI Coach</b> — ask anything about your training, on the Coach tab</li>
      </ul>
      <p>Your physiology stays on your device — sync to the cloud only if you opt in.</p>
      <p>See you out there,<br/>the rythm team</p>`;
  }
  if (kind === "weekly_digest") {
    return `${hi}
      <p>Your last 7 days, reviewed — recovery trend, what worked, what didn't, and the plan
      for next week. Open the app to read it.</p>
      <p>Consistency compounds. See you next Monday.</p>`;
  }
  if (kind === "friend_request") {
    const from = data.from ? esc(data.from) : "A friend";
    return `${hi}
      <p><b>${from}</b> wants to be your training partner on rythm. Accept the request in
      the Friends tab, then race their workouts with ghost racing 👻.</p>`;
  }
  if (kind === "milestone") {
    const detail = data.detail ? esc(data.detail) : "A new personal record";
    return `${hi}
      <p>${detail} — that's a personal best. Check the Records &amp; PRs tab for the full list.</p>`;
  }
  return `${hi}<p>Here's an update from rythm.</p>`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = process.env.MAIL_API_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: MailBody = {};
  try {
    body = (await req.json()) as MailBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!KIND_SUBJECTS[kind]) return json({ error: `unknown kind: ${kind}` }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "invalid recipient" }, 400);

  const key = `${to}|${kind}`;
  const now = Date.now();
  if (lastSent.has(key) && now - (lastSent.get(key) ?? 0) < RATE_LIMIT_MS) {
    return json({ ok: true, skipped: "rate-limited" }); // not an error — just skip
  }
  lastSent.set(key, now);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return json({ error: "RESEND_API_KEY is not set" }, 500);
  const from = process.env.MAIL_FROM ?? "rythm <onboarding@resend.dev>";
  const name = typeof body.name === "string" ? body.name : "";
  const data = body.data && typeof body.data === "object" ? body.data : {};

  const html = renderBody(kind, name, data);
  const subject = KIND_SUBJECTS[kind];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      const err = (await res.text()).slice(0, 300);
      return json({ error: `resend ${res.status}: ${err}` }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message ?? "resend unreachable" }, 502);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
