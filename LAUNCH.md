# rythm — Launch Runbook

How to take the app from this repo to a live public test. Follow top to bottom;
each section is a prerequisite for the next. Everything marked **(you)** is a
manual step in a console/dashboard — the repo side is already done.

## 0. What you're deploying

- A **single-file PWA** (`dist/index.html` + `public/` assets) that runs offline
  and installs to the home screen.
- Two **serverless functions** (`api/coach.ts`, `api/mail.ts`) that keep API keys
  server-side. Vercel picks these up automatically from the `api/` dir;
  Netlify/Cloudflare need a tiny config (see §5).

---

## 1. Build once, verify locally

```bash
npm install
npm test          # 187+ tests
npm run build     # typecheck + production build
```

Open `dist/index.html` through a static server (e.g. `npx serve dist`) and click
through: sign up → onboarding → tour → record a run → add a habit → open the
Coach. Confirm the version chip says **v1.0.0** (Settings → About).

## 2. Env vars — what goes where

Copy `.env.example` → `.env.local`. Values marked **(client)** are baked into
the build at `npm run build` time. Values marked **(server)** are set on the
platform dashboard (never in the repo, never in the client).

| Variable | Where | Required? | Notes |
|---|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | client | yes | from Google Cloud Console |
| `VITE_AUTHORIZED_ORIGINS` | client | yes | deployed origin + `http://localhost:5173` |
| `VITE_SUPABASE_URL` | client | yes | project URL |
| `VITE_SUPABASE_ANON_KEY` | client | yes | public anon key (RLS protects the data) |
| `VITE_COACH_API` | client | yes for AI | `https://<your-app>.vercel.app/api/coach` |
| `VITE_COACH_API_TOKEN` | client | optional | must match `COACH_API_TOKEN` (server) |
| `VITE_FEEDBACK_EMAIL` | client | optional | where tester feedback lands |
| `VITE_MAIL_API_TOKEN` | client | optional | must match `MAIL_API_TOKEN` (server) |
| `VITE_GEMINI_API_KEY` | client | dev only | ships in the bundle — restrict by referrer or remove for prod |
| `RESEND_API_KEY` | server | yes for email | Resend project key |
| `MAIL_FROM` | server | yes for email | verified sender, e.g. `rythm <hi@rythm.app>` |
| `MAIL_API_TOKEN` | server | optional | bearer token for `/api/mail` |
| `LLM_PROVIDER` | server | yes for AI | `openai` \| `anthropic` \| `gemini` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | server | one of | model key for the coach function |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` | server | optional | defaults are set in `api/coach.ts` |
| `COACH_API_TOKEN` | server | optional | bearer token for `/api/coach` |

> Rule of thumb: anything the app fetches with `import.meta.env.VITE_*` is
> client; anything read from `process.env` inside `api/*.ts` is server.

## 3. External setup — **(you)**

### Google Cloud Console
1. APIs & Services → Credentials → your OAuth client ID (Web application).
2. **Authorized JavaScript origins**: add your deployed origin
   (e.g. `https://rythm.app`) and `http://localhost:5173`. No trailing slash.
3. Save. The origin list must match `VITE_AUTHORIZED_ORIGINS`.

### Supabase
1. Project → SQL Editor → run `supabase/migrations/0001_init.sql` and
   `supabase/migrations/0002_friends.sql` (both are idempotent-friendly; run in
   order).
2. Auth → Providers → **Email**: enable (confirmation emails on).
3. Auth → Providers → **Google**: enable, callback URL
   `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Auth → URL Configuration → Site URL = your deployed origin.
5. (Optional but recommended) Auth → Settings → enable "Confirm email".

### Resend
1. Domains → add + verify your domain (e.g. `rythm.app`).
2. API Keys → create a **sending-only** key → `RESEND_API_KEY` (server).
3. `MAIL_FROM` = a sender on the verified domain.
   - Until the domain is verified, emails only deliver to your own verified
     address (sandbox) — welcome emails to real users need this step done.

### DNS
- Point your domain (A/AAAA or CNAME) at the host before the launch date —
  HTTPS is required for Web Bluetooth, geolocation and Google OAuth.

## 4. Deploy **(you)**

### Vercel (zero config)
1. Import the repo (or `vercel` CLI). `vercel.json` already sets the build
   command, output dir and function config.
2. Project → Settings → Environment Variables: paste the **server** vars
   (`RESEND_API_KEY`, `MAIL_FROM`, `LLM_PROVIDER`, model keys, tokens).
3. Set the **client** vars as build-time env vars too (Vite reads them during
   `npm run build`).
4. Deploy. Confirm:
   - `GET https://<your-app>.vercel.app/` serves the app.
   - `POST https://<your-app>.vercel.app/api/coach` exists (401/400 without a
     token is fine — it means the function is alive).
   - `POST https://<your-app>.vercel.app/api/mail` exists (405 on GET is fine).
   - `GET https://<your-app>.vercel.app/legal/privacy.html` serves the policy.

### Netlify / Cloudflare Pages
- Build command `npm run build`, output `dist`.
- Netlify: `netlify.toml` with `[functions] directory = "api"` (Node 18+);
  each `api/*.ts` becomes `/.netlify/functions/coach`. Update
  `VITE_COACH_API`/`VITE_MAIL_API` to those URLs.
- Cloudflare: Pages Functions from `api/`; set `VITE_COACH_API` to the
  `https://<project>.pages.dev/api/coach` route.

## 5. Pre-launch QA checklist

Run this on the **live URL** after deploy:

- [ ] **Auth**: Google sign-in (real popup, no 400), email sign-up + confirm,
      demo chooser; each lands on onboarding → tour.
- [ ] **Onboarding**: age/sex/weight/height/goal/phone; Settings edits persist.
- [ ] **Blank accounts**: a real (non-demo) account shows the 7-day learning
      window and `—` metrics — no fabricated scores.
- [ ] **Recording**: start a run with location granted (real route) and with
      simulated GPS; finish → post-workout insight → feed.
- [ ] **Habits**: add/edit/delete, log past days, streak + heatmap.
- [ ] **Friends**: send a request to another real account's email, accept from
      the other device (needs the friends backend live — see §6), photos load.
- [ ] **Coach**: chat works (deterministic if no LLM key, ✨ AI-powered if the
      function is wired); morning brief vs. new-user welcome.
- [ ] **Email**: sign up a throwaway → welcome email arrives (requires the
      verified Resend domain).
- [ ] **Sync**: Settings → Cloud sync on → data survives reload + second device
      (last-write-wins by timestamp — note this to testers).
- [ ] **PWA**: install → open offline → app shell works.
- [ ] **Data controls**: export JSON/CSVs; delete account wipes local + cloud
      and returns to the auth gate; re-signup is blank.
- [ ] **Legal**: Privacy/Terms open in-app and at `/legal/*` URLs.
- [ ] **Crash shield**: force an error — recovery screen shows, no white screen.

## 6. Known limitations to publish alongside the beta

- **iPhone wearable data** requires the native app (HealthKit). The web PWA
  connects BLE HR straps/watches on Chrome/Android/desktop only — Safari has no
  Web Bluetooth.
- **Friends are local/simulated by default.** Real cross-account friends need
  the `0002_friends.sql` migration deployed **and** sync enabled on both
  accounts. Until then, the directory is demo accounts.
- **Sync is last-write-wins**, not a full merge — editing the same habit on two
  devices can clobber.
- **Data is local-first**: clearing site data without cloud sync clears the
  account (by design — privacy over convenience).
- Scores, VO₂max and biological age are **estimates** from the documented
  formulas, not lab measurements.

## 7. Go / no-go

**Go** when: build v1.0.0 deploys, Google + email sign-in work on the live
origin, welcome emails deliver, the coach function answers, the friends
migration is applied, PWA installs offline, export/delete verified, legal URLs
live, and the QA checklist above is green on the live URL.

**Blockers** (fix before announcing): any auth failure on the live origin,
welcome emails not delivering, PWA not installing, or the delete-account flow
leaving data behind.

## 7b. Tester milestone: the native health bridge

Before the full native app, ship the **tester build** in `native/` — it
validates the riskiest part of the product (real wearable data) on real
devices. It signs in with the same Supabase account, reads the last 24h of
HealthKit / Health Connect data, shows a summary, and pushes it to the
`health_samples` table (migration 0003) the web app's merge engine can read.

```bash
cd native
npm install
cp .env.example .env   # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
npx eas login
npx eas build -p android --profile preview   # → downloadable APK link
npx eas build -p ios --profile preview       # → TestFlight
```

**Requirements (the two long poles — start them early):**

1. **Apple Developer account ($99/yr)** — required for TestFlight; there is no
   way around it for iOS distribution.
2. **Health Connect allowlist** — submit the Play Console health-apps
declaration as soon as you have a package name (`app.rythm`). Approval can
take ~7 days plus 5–7 business days for whitelist propagation. Developers can
run a small private round via the developer testing flow meanwhile.

Tester flow: install → sign in with the same email as the web app → "Read last
24h of health data" → grant permissions → see the summary → "Sync to my
Supabase project". Feedback lands via Settings → Send feedback in the web app.

## 8. Launch-day sequence

1. Final `npm run build` with production env vars.
2. Deploy; run the QA checklist.
3. Bump `APP_VERSION` in `src/lib/version.ts` + `package.json` **after** launch
   (so the shipped build keeps its number).
4. Announce the invite link; keep an eye on Settings → feedback email and the
   error rate in the host dashboard.
