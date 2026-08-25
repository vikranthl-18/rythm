# rythm — native app (Expo)

Two tabs in one install:

- **App tab** — the FULL rythm product (dashboard, workouts, habits, coach,
  friends, settings) embedded as a WebView. Same pixels, same features, same
  code — it *is* the web app, so it can't diverge. It loads
  `EXPO_PUBLIC_WEB_URL` (your deployed web app; until it's deployed the tab
  shows a clear "point me at it" screen).
- **Health tab** — the native wearable bridge. A PWA can't reach Apple
  HealthKit or Android Health Connect — those are native APIs. This tab reads
  real wearable data (Apple Watch / iPhone, Pixel Watch / Wear OS, Garmin via
  Health Connect) and syncs it to the same Supabase project, where the web
  app's priority-merge engine consumes it.

> **Why a shell instead of a native rewrite?** The web app is ~13,700 lines
> across 21 screens/components and 19 engines. A rewrite would take weeks,
> ship bugs, and drift from the web app. The shell gets testers the exact
> product today, with zero divergence — the native layer does only what a
> browser can't (wearable reads).
>
> **Status: tester-ready once the web app is deployed.** Set `EXPO_PUBLIC_WEB_URL`
> to the deployed app, and the App tab IS the app. The Health tab signs in
> (same Supabase account), reads the last 24h of real health data, and pushes
> it to `health_samples` (migration 0003) for the merge engine.

## 1. What's in here

```
native/
  App.tsx              entry — sign in → read health → summary → sync to cloud
  app.json             app config (names, permissions, bundle ids, scheme)
  eas.json             build profiles (preview APK / TestFlight, production)  package.json         expo + health SDK deps (SDK 57)
  src/
    healthkit.ts       Apple HealthKit reader (@kayzmann/expo-healthkit)
    healthconnect.ts   Android Health Connect reader (react-native-health-connect v4)
    bridge.ts          converts native records → MergeSample[] (merge-engine input)
    sync.ts            Supabase client, sign-in, push/pull of health_samples
    types.ts           the merge-engine sample shape, kept in sync with
                       ../src/engine/priority.ts (MergeSample / ResolvedReading)
  README.md            this file
```

> Package note (Aug 2026): `expo-health` is unpublished and `expo-health-connect`
> is deprecated — the deprecated package also breaks Android builds (duplicate
> class with `react-native-health-connect`). This scaffold uses the current
> packages: `@kayzmann/expo-healthkit` (iOS) and `react-native-health-connect`
> v4 (Android, with the Expo config plugin built in). Both are typechecked
> against their real published types.
>
> **Verified:** `npx expo prebuild -p android` runs clean — the generated
> manifest contains all 9 health permissions, SDK 36 / minSdk 26 are applied,
> and `plugins/with-health-connect-delegate.js` patches MainActivity to
> register the Health Connect permission delegate (the package's "automatic"
> registration doesn't actually happen in v4.1.3 — without the patch,
> `requestPermission` crashes on device).

## 2. Build for testers (APK + iOS test build)

### Setup once

```bash
cd native
npm install
cp .env.example .env     # fill EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY (same project as the web app)
npm install -g eas-cli   # or use npx eas-cli
npx eas login
npx eas init
```

### Android APK (the easy one)

```bash
npx eas build -p android --profile preview
```

EAS Build compiles in the cloud (free tier) and gives you a **downloadable
APK** link you can send to testers directly. Anyone can install it by enabling
"install unknown apps" for your distribution. To build locally instead:
`npx expo prebuild -p android` then `cd android && ./gradlew assembleRelease`.

### iOS (TestFlight)

```bash
npx eas build -p ios --profile preview
```

- **Requirement:** an Apple Developer account (**$99/yr**) — Apple requires it
  for any distribution. There's no way around this.
- The build lands in **TestFlight**, where you add tester emails (up to 100
  devices / 10k testers). They install via the TestFlight app.
- For a quick local check first: `npx expo run:ios` on a simulator.

### Pushing updates over the air (EAS Update)

Once a build includes `expo-updates` (it's in `package.json` now), JS-only
changes ship to already-installed test builds — no reinstall:

```bash
npx eas update --channel preview --message "fix: lazy-load healthkit"
```

Every `eas build --profile preview` build pins the `preview` channel, so
`eas update --channel preview` reaches all of them. Native changes (new
native modules, SDK bumps, config-plugin changes) still need a fresh
`eas build` — but the crash fix in `src/healthkit.ts` is pure JS and can ship
entirely over the air.

> Note: `eas update` requires the EAS project to exist and you to be logged
> in — same as builds. The update URL in `app.json` points at the project
> created by `eas init`.

### Platform notes

- **iOS / HealthKit**: `@kayzmann/expo-healthkit` handles the HealthKit
  entitlement automatically via its config plugin (no manual Xcode steps).
  One known gap: this package exposes the HRV permission but no HRV read
  function yet — `native/src/healthkit.ts` marks the exact spot to add it.
- **Android / Health Connect**: Health Connect is an OS-level app (Pixel 8+
  preinstalled; otherwise from the Play Store). Before testers can grant
  access, the app must be allowlisted: **Play Console → Health apps
  declaration** (this is how Google handles Health Connect access as of
  2026 — the standalone form is retired). Approval can take up to 7 days,
  plus 5–7 business days for the whitelist to propagate. For a small private
  tester round, developers can test before approval using the developer
  testing flow; plan the approval early regardless.
- **Sensitive data**: both stores will ask for a privacy policy URL before
  approval — the web app's hosted policy (`/legal/privacy.html`) covers this
  app's data practices.

### Tester flow

1. Tester installs the APK / TestFlight build.
2. **App tab** — signs in with their account (email or Google — Google goes
   through Supabase's hosted OAuth redirect, which works inside the WebView;
   the fallback demo/GIS-popup path does not and is never used when Supabase
   is configured). The whole product is right there.
3. **Health tab** — signs in (same email), taps "Read last 24h of health
   data" → grants HealthKit / Health Connect permissions → sees the summary
   (HR, HRV, steps, sleep).
4. Taps "Sync to my Supabase project" → rows appear in `health_samples`.
5. Feedback comes back through Settings → Send feedback in the web app.

### If Health Connect blocks the app

The tester build distinguishes the failure modes (`native/src/healthconnect.ts`):

- **"Health Connect blocked this app (not allowlisted yet)"** → the Play
  Console declaration hasn't propagated. This is a Google-side gate, not a
  bug — follow `HEALTH_CONNECT_DECLARATION.md`.
- **"Health Connect isn't available"** → the tester's device doesn't have
  Health Connect installed (Play Store, or preinstalled on Pixel 8+).
- **"Health Connect access was declined"** → the tester declined in the
  permission dialog; they can re-grant in the Health Connect app.

## 3. Run it (development)

```bash
cd native
npm install
npx expo run:ios      # or: run:android (device/simulator with Health Connect)
```

- **iOS**: HealthKit works on a real iPhone or a HealthKit-capable simulator.
  The app asks for read permissions on first run; the HealthKit entitlement
  is configured automatically by the config plugin.
- **Android**: Health Connect must be installed (Play Store; preinstalled on
  Pixel 8+). The reader checks `getSdkStatus` and shows a clear error if it's
  missing.

## 4. What each reader produces

| Reader | Records | Mapped metrics |
|---|---|---|
| `healthkit.ts` | heart rate, resting HR, HRV (SDNN/RMSSD), steps, active energy, sleep stages, workouts (runs/rides), oxygen saturation, body temperature | hr, restingHR, hrv, steps, calories, sleep, spo2, skinTemp |
| `healthconnect.ts` | heart rate, resting HR, HRV, steps, calories, active minutes, sleep sessions/stages, workouts | hr, restingHR, hrv, steps, calories, zoneMinutes, sleep |

Records are returned as **platform-neutral `NativeRecord[]`**, then
`bridge.ts` converts them into `MergeSample[]` — the exact shape
`src/engine/priority.ts` consumes — so the web app's device-slot priority
rules (Rule 1 time-overlap, Rule 2 per-metric priority, Rule 3 fallback) apply
unchanged to real hardware.

## 5. The bridge (the important part)

`src/bridge.ts` maps a record like `{ type: "heartRate", start, end, bpm }`
into `{ deviceId, metric, t, value }`. `deviceId` is the **slot id the user
assigned in the web app** (e.g. `Pixel Watch 2` = Slot 1). Keep the `MetricKey`
union in `src/types.ts` (native) in sync with the web app's `src/types.ts`.

The web app's store (`src/store.ts`) is the documented swap point: replace the
simulated samples in the `tick` with real ones from this bridge. For a
native-first build, you don't even need the web shell — the engines are pure
TypeScript and can be copied into `native/src/engine/` as-is.

## 6. How web + native share state

The shell architecture (this repo) is shape 1: **native embeds the web app**
and adds wearable reads the browser can't do. Health data flows
HealthKit/Health Connect → native → Supabase `health_samples` → web app's
merge engine.

If you later want a fully-native UI (no WebView), the engines copy over
unchanged — `src/engine/*` are pure TypeScript with no DOM dependencies. The
WebView shell is deliberately the first step: it's the only way to get "the
app we built" onto testers' phones without weeks of porting and a second bug
set.

## 7. Permissions & privacy

- Everything is read-only; nothing is uploaded unless the user opts into
  cloud sync (same policy as the web app — local-first by default).
- Health Connect: declare only the data types you actually read in
  `healthconnect.ts` (Android shows users exactly this list).
- HealthKit: request granular per-type permissions (the prompt lists every
  type the app reads).
