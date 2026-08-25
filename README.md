# rythm — unified athlete ecosystem

A working implementation of the **AuraFit** PRD: a multi-device health
aggregator with Whoop-style Recovery & Strain, Strava-style GPS workout
tracking, a Notion-style habit engine, and a context-aware AI coach.

This repo is a **runnable web demo** of the full product. All five PRD modules
are implemented with real engines (pure TypeScript, unit-tested); a live
"simulation layer" stands in for the device integration gateways so the whole
flow works end-to-end without hardware. The same engines port directly to the
React Native / Expo app and the Node + Postgres backend described below.

## Quick start

```bash
npm install
npm run dev       # local dev server (http://localhost:5173)
npm test          # engine unit tests (vitest)
npm run build     # typecheck + production build (single-file dist/index.html)
```

## Sign in & accounts

The app opens on an auth gate — you must sign up / sign in before it loads.

- **With Supabase configured** (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`,
  see [Cloud sync](#cloud-sync-supabase)): accounts are **real**. Google goes
  through Supabase OAuth — Supabase's auth server exchanges and **verifies the
  Google ID token server-side** — and email/password accounts are stored
  hashed in Supabase Auth with email confirmation.
- **Without Supabase** the app runs in **demo mode**: the Google button opens
  an offline account chooser (or Google Identity Services if you set
  `VITE_GOOGLE_CLIENT_ID`), and email/password accounts are stored in
  localStorage. Everything downstream is identical.
- The signed-in account shows in **Settings → Account** with a **Log out**
  button; logging out returns you to the auth gate (and signs the Supabase
  session out when configured).

> Security note: the no-Supabase demo decodes the Google ID token client-side.
> With Supabase, token verification is server-side by Supabase Auth — never
> decode a client token yourself in production.

> **Never commit secrets.** Real credentials live in `.env.local` (gitignored);
> `.env.example` is placeholders only. If you initialize a git repo, confirm
> `.env.local` never gets staged (`git status` before every commit).

### Fixing the Google button ("couldn't render" / "Error 400: invalid_request")

The most common Google sign-in failure is that the page's origin isn't on the
client ID's **Authorized JavaScript origins** list. Depending on how Google
surfaces it you'll see a **`403` on the GIS iframe** (button never renders) or
an **`Error 400: invalid_request`** popup when you click the button. The app
handles both:

- **`VITE_AUTHORIZED_ORIGINS`** — a comma-separated list (in `.env.local`) of
  the origins your client ID is authorized for, e.g.
  `http://localhost:5173,https://your-app.com`. When set, the app checks the
  current origin against it **before** rendering the real button: if the
  origin isn't listed, the button is hidden (so you never hit the 400 popup)
  and the app shows the exact origin + copy button + the Console steps below,
  plus the offline demo chooser so you can still get in.
- If the list is unset, the app falls back to the timeout heuristic (GIS has
  no failure callback) and shows the same fix panel when the button can't
  render.

But the actual fix is in Google Cloud Console:

1. Go to **console.cloud.google.com → APIs & Services → Credentials**.
2. Click the **OAuth 2.0 Client ID** for this app (the ID ends in
   `apps.googleusercontent.com`).
3. Under **Authorized JavaScript origins**, click **Add URI** and paste the
   origin the app shows you (e.g. `http://localhost:5173` for local dev, and
   your deployed domain — with **no** trailing slash or path). Keep this list
   in sync with `VITE_AUTHORIZED_ORIGINS` in `.env.local`.
4. Click **Save**, then hard-refresh the page. The real button now works.

Notes:
- You do **not** need an Authorized redirect URI for the GIS popup flow — only
  the JavaScript origins list.
- Localhost special-case: Google accepts `http://localhost:5173` (or any
  localhost port) as-is; `127.0.0.1` is treated as a *different* origin — the
  Freebuff preview runs on a random `127.0.0.1` port, which is why it 400s.
- The demo chooser always works as a fallback, so the app is never stuck.

## Deployment

The production build is a single self-contained `dist/index.html` (Vite +
`vite-plugin-singlefile`) — no server required. Deploy it to any static host:

```bash
npm run build
# then upload dist/ to Vercel, Netlify, Cloudflare Pages, GitHub Pages…
```

1. Create a Google OAuth client ID (console.cloud.google.com → APIs &
   Services → Credentials → Create OAuth client → Web application) and add
   your deployed origin as an *Authorized JavaScript origin*.
2. Copy `.env.example` to `.env.local`, set `VITE_GOOGLE_CLIENT_ID`, rebuild.
3. For real multi-user data, set up Supabase (below) — accounts, server-side
   Google verification, and opt-in cloud sync are already wired in. Then point
   the AI Coach's `coachReply` at a serverless function wrapping an LLM call
   (`buildCoachContext` + `buildSystemPrompt` already produce the exact prompt).

## Public testing release

The app is release-shaped for an invite/public test: PWA (installable +
offline), crash shield, privacy & terms, data export/delete, in-app feedback,
and a visible build version. This is the release checklist:

1. **Env** — copy `.env.example` → `.env.local`: set `VITE_GOOGLE_CLIENT_ID`,
   `VITE_AUTHORIZED_ORIGINS` (deployed origin + `http://localhost:5173`), and
   optionally `VITE_COACH_API` + `VITE_COACH_API_TOKEN` (real LLM via
   `api/coach.ts`, keys stay server-side) or `VITE_FEEDBACK_EMAIL`.
2. **Google Console** — the deployed origin must be in the client ID's
   *Authorized JavaScript origins* (see “Fixing the Google button”).
3. **Bump the version** — edit `src/lib/version.ts` (`APP_VERSION`) and
   `package.json`; the version shows in Settings → About and in feedback
   emails, so testers can say “on build X”.
4. **Build & deploy** — `npm run build` (single-file `dist/index.html` +
   `public/` assets), deploy `dist/` to Vercel/Netlify/Cloudflare (the repo
   ships `vercel.json`; `api/coach.ts` becomes the serverless coach).
5. **Verify the release checklist on the live URL:**
   - Sign in with Google (real popup), sign up with email, and the demo
     chooser; onboarding collects age/sex/weight/height/goal.
   - Install as PWA (desktop Chrome “Install”, iOS “Add to Home Screen”);
     open offline — everything but maps/AI still works.
   - Data controls: Settings → Data → export JSON + CSVs; delete account
     clears everything and returns to the auth gate.
   - Feedback: Settings → Send feedback opens a prefilled email with build
     info. Set `VITE_FEEDBACK_EMAIL` to where you want it to land.
   - Crash shield: the app never white-screens — errors show a recovery
     screen with the message and a data reset.
6. **Known limitations to tell testers about** (no surprises):
   - Data lives in the **browser by default** (localStorage) — without Cloud
     sync, clearing site data clears the account.
   - **Real accounts start blank** (today's vitals only — no workouts,
     habits or devices until they record them); only the demo chooser
     accounts carry sample data.
   - Health Connect / HealthKit need the native app; this web build connects
     real BLE fitness devices over Web Bluetooth (live heart rate replaces
     the simulation).
   - Cloud sync is last-write-wins by timestamp, not a full CRDT merge —
     editing the same habit on two devices can clobber, and sync needs a
     Supabase project (see below).

## Connecting real health devices

A PWA can't reach Android Health Connect or Apple HealthKit (native APIs),
but it CAN talk to real BLE fitness devices over **Web Bluetooth** (Chrome /
Edge on HTTPS):

- **Devices → Bluetooth health device → Pair a device** opens the browser's
  Bluetooth chooser filtered to devices exposing the standard **Heart Rate
  Service (0x180D)** — HR straps, watches and rings.
- Live HR streams in (Heart Rate Measurement characteristic 0x2A37) and
  **replaces the simulated heart rate** everywhere: dashboard, strain
  accumulation, and workout recordings. Battery level (0x180F) is read when
  the device exposes it.
- The paired device is remembered and **reconnects automatically** on load.
  Disconnect removes it.
- Health Connect / HealthKit are the native-app milestone: **`native/`** in
  this repo is a scaffolded Expo app with working HealthKit + Health Connect
  readers (`native/src/healthkit.ts`, `native/src/healthconnect.ts`) that
  convert records into `MergeSample[]` (`native/src/bridge.ts`) — the exact
  shape the priority engine consumes. The store's device layer
  (`src/store.ts` sim + `src/engine/priority.ts`) is the swap point: real
  samples flow through the same merge rules. See `native/README.md`.

## Real friends (multi-user)

Friends are **real accounts** when Supabase is configured and the signed-in
user is a real (non-demo) account; demo accounts keep the simulated directory
so the offline demo still shows the full lifecycle.

- Run `supabase/migrations/0002_friends.sql` (after `0001_init.sql`) — it
  adds `friend_requests` + `friendships` tables and security-definer RPCs
  (`send_friend_request`, `accept_friend_request`, `decline_friend_request`,
  `remove_friend`, `friends_of`, `incoming_requests`, `outgoing_requests`,
  `search_users`, `lookup_phones`). Writes only happen through the RPCs, which
  re-check `auth.uid()` server-side.
- **Requests are real**: sending by email creates a server-side request;
  acceptance happens on the other user's device and both sides see the new
  friend. No more simulated "they accept in 6 seconds".
- **Discovery is privacy-first**: `search_users` matches name/email only;
  `lookup_phones` accepts your contacts' phone numbers and returns only
  matches — no phone numbers are ever exposed. The Friends UI searches real
  accounts when the backend is live and falls back to the local directory
  otherwise.
- Your profile row (name/phone/avatar/goal) is kept in sync so others can
  find you — phone is only used for contacts matching and never shown.
- **Requirement**: both accounts must have opted into Cloud sync at least
  once (that's what creates their profile row).

## What's inside

## Cloud sync (Supabase)

The app is **local-first by default**: every metric, workout, habit and friend
lives in your browser, and nothing leaves the device until a user flips on
**Settings → Cloud sync**. Wiring in Supabase gives you real accounts,
server-side Google verification, and an opt-in backup that follows the user
across devices:

1. Create a project at https://supabase.com (free tier is fine).
2. Run `supabase/migrations/0001_init.sql` in the project's **SQL Editor**.
   It creates two tables — `profiles` and `user_snapshots` (the user's full
   state as JSONB) — with **Row Level Security** on both: every policy is
   `auth.uid() = owner`, so the public anon key can only ever touch the
   signed-in user's own rows.
3. **Auth → Providers → Google** — enable it and set the callback URL to
   `https://<project-ref>.supabase.co/auth/v1/callback`. Google sign-in in the
   app then runs through Supabase Auth, which verifies the ID token
   **server-side** — the app never sees an unverified credential.
4. Copy `.env.example` → `.env.local` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Rebuild.

How sync behaves:

- **Default off.** The toggle in Settings is off until the user opts in.
- **Push** — workouts, habits, friends, profile and metrics back up ~4s after
  the change (debounced), plus a 15-minute heartbeat and on tab-visible.
- **Pull** — on load, if the cloud snapshot is newer than this device's last
  sync, it's applied and the app reloads. Conflicts resolve **last-write-wins
  by timestamp**.
- **Delete account** removes the cloud rows too; **Log out** signs the
  Supabase session out.
- Everything still works fully offline and with sync off — the cloud is an
  optional mirror, never a dependency.

## Transactional email

rythm can send emails (a welcome email on sign-up, plus weekly digest, friend
request and PR-milestone templates) through a small serverless function,
`api/mail.ts` — the same Vercel pattern as the coach. The app posts to
**same-origin `/api/mail`** by default, so:

- **Dev (no deployment needed):** the Vite dev server serves `/api/mail`
  itself (see `vite.config.ts`), reading the Resend key from `.env.local`
  server-side — emails work locally with zero setup beyond env vars.
- **Prod:** Vercel deploys `api/mail.ts` to `/api/mail` automatically.

Set up:

1. Create a project at https://resend.com, add **+ verify a domain** (or just
   verify your own address for the sandbox sender).
2. In `.env.local` (dev) / the platform (Vercel dashboard → project env
   vars): `RESEND_API_KEY`, `MAIL_FROM` (a verified sender, e.g.
   `rythm <hi@your-app.com>`). Optional `MAIL_API_TOKEN` + matching
   `VITE_MAIL_API_TOKEN` to require a bearer token.
3. Rebuild. Real accounts (non-demo) get a welcome email the moment they
   finish onboarding; the other kinds are ready in `api/mail.ts` for future
   digests/notifications. Emails are fire-and-forget from the app — a
   failure or missing key never blocks anything.

**Sandbox note:** until you verify a domain, Resend only delivers to your own
verified address (and requires `to: delivered@resend.dev` for API tests), so
welcome emails to real users need the verified domain step.

Note: Supabase Auth also sends its own confirmation emails when email
sign-ups are enabled (Authentication → Providers → Email).

## AI coach: wiring a real LLM

Out of the box the coach is a **deterministic engine** that runs fully offline
and answers from the same physiological context a model would see. The model
paths resolve in this order:

1. **`VITE_COACH_API`** — your deployed serverless function (`api/coach.ts`;
   Vercel auto-detects the `api/` dir, ports to Netlify/Cloudflare almost
   verbatim). Model keys live **server-side**, never in the bundle. Set on the
   platform:
   - `LLM_PROVIDER=openai` (default) | `anthropic` | `gemini`
   - `OPENAI_API_KEY` / `OPENAI_MODEL` (default `gpt-4o-mini`)
   - `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (default `claude-3-5-haiku-latest`)
   - `GEMINI_API_KEY` / `GEMINI_MODEL` (default `gemini-3.5-flash`)
   - optional `COACH_API_TOKEN` to require a bearer token
2. **`VITE_GEMINI_API_KEY`** — direct browser calls to Google Gemini (no
   server needed; Google ships Gemini keys for client use). ⚠️ A `VITE_*` key
   is **visible in the bundle** — for production prefer path 1, and restrict
   this key by HTTP referrer in Google Cloud Console.
3. **Neither set** — the deterministic engine (offline).

The chat routes with `buildSystemPrompt` + the last few turns as history; the
Coach header shows **✨ AI-powered** whenever a model path is configured. If
the call fails, times out (15s), or no path is set, the coach silently falls
back to the on-device engine (**on-device engine**) — the app never breaks.

The **same model path powers the AI analysis blocks** across the score sheets
(`src/engine/aiInsight.ts` + `src/components/AiInsight.tsx`): the AI metrics
(VO₂max, biological age, fitness score), the Rythm Score, training load
balance, and readiness each build a grounded prompt from your real numbers and
show either a live model review (**✨ AI-powered**) or a deterministic,
formula-grounded fallback (**on-device engine**) with a "re-run with live
data" button. `llmComplete` is the single shared resolution function.

## What's inside

| PRD module | Where | What it does |
|---|---|---|
| Multi-device sync & priority engine | `src/engine/priority.ts` | 3 device slots, per-metric priority overrides, time-overlap resolution, battery/connection fallback (imputation) |
| Recovery & Strain engine | `src/engine/recovery.ts`, `src/engine/zones.ts` | Weighted recovery 0–100 vs 7-day baselines; saturating strain 0–21 from HR-zone minutes; strain targets by recovery color |
| Workout engine | `src/engine/zones.ts` + `src/screens/Activity.tsx` | Live GPS recording (real geolocation when granted, simulated loop otherwise), distance/pace/splits/elevation, pace-colored map, HR-zone breakdowns, weekly totals |
| Habit engine | `src/engine/habits.ts` | Daily/weekdays/custom frequencies, streaks, completion rates, biometric auto-completion ("Sleep 7.5h" checks itself from the wearable) |
| AI Coach | `src/engine/coach.ts` | Context-window assembly (recovery, strain, sleep, habits, week) + morning brief + grounded Q&A; `buildSystemPrompt` shows the exact LLM swap point |

Demo data lives in `src/data/seed.ts` and is generated by **running the real
engines** — recovery scores come from `computeRecovery`, sleep needs from the
sleep-debt chain, workout strain from the zone distributions — so the numbers
are internally consistent, not fabricated.

## The algorithms

**Recovery (0–100).** `Recovery = w₁·f(ΔHRV) + w₂·f(ΔRHR) + w₃·SleepQuality + w₄·f(SkinTemp)`
with weights 0.35 / 0.25 / 0.30 / 0.10. Each Δ is today's morning value vs the
7-day rolling baseline expressed in standard deviations and mapped to 0–100.
Bands: green 67–100, yellow 34–66, red 0–33.

**Strain (0–21).** Zone-weighted minutes accumulate through the day
(weights `[0.01, 0.1, 1, 3, 4.5]` for Z1–Z5, `HRmax = 220 − age`) and map through
a saturating curve `strain(W) = 21·(1 − e^(−W/42))` — strain is easy to earn at
first and gets harder, mirroring Whoop. Workouts use the same curve, so a
45-min tempo run reads ≈14–16 and a rest day ≈4–6.

**Sleep.** Score = 45% duration-vs-need + 30% efficiency + 25% deep/REM
proportion. Need = 7.5h base + strain adjustment + carried sleep debt.

**Habits.** Streaks survive a pending today (they only break at day's end),
auto-sync habits complete from live biometrics, and a manual check always
overrides the auto state.

## Simulation layer

`src/store.ts` runs a 1.5s-per-simulated-minute clock that streams per-device
samples (Pixel Watch 2 / Colmi Ring R09 / Apple Watch) through the *same*
priority-merge engine real device pushes would use — dense PPG HR from the
ring at 3-min cadence, watch HR at 5-min, overlapping overnight readings for
Rule-1 resolution, and visible fallback when a device drops. Watch the
**Devices** tab's live feed: rotating a metric's priority changes the source
instantly.

## Roadmap to production (from the PRD)

1. **Mobile**: **`native/`** is the scaffolded Expo app — finish the sleep
   stage reads, wire its `MergeSample[]` stream into the merge engine, and
   share state with the web app via the existing cloud sync (see
   `native/README.md` §5 for the two integration shapes).
2. **Backend**: `server/schema.sql` (Postgres + TimescaleDB + pgvector)
   mirrors the in-app state; sync jobs persist merged metrics and run the
   daily summary/recovery job. Real friends are already in
   `supabase/migrations/0002_friends.sql`; shared workout feeds between
   friends are the next table set.
3. **AI Coach**: the `api/coach.ts` serverless function already proxies
   `buildCoachContext` + `buildSystemPrompt` to OpenAI or Anthropic — add
   pgvector retrieval over past briefs and multi-user sessions.
4. **Maps**: swap Leaflet/OSM for Mapbox when a token is available
   (the route rendering layer is already isolated in `MapView`).
5. **Launch**: follow `LAUNCH.md` — deploy, env vars, Google/Resend/Supabase
   setup, and the pre-launch QA checklist.

## Project layout

```
src/
  engine/      pure, tested algorithms (recovery, strain, sleep, habits, priority, coach)
  data/        deterministic demo data (built by running the engines)
  lib/         rng, geo math
  screens/     Dashboard, Activity, Habits, Devices, Coach
  components/  rings, gauges, charts, primitives
  store.ts     zustand store + live simulation + GPS recording
scripts/       sanity.ts — prints calibration numbers for tuning
server/        schema.sql — production database schema
```
