# Health Connect declaration — step-by-step

Health Connect only grants permissions to **allowlisted** apps. The allowlist is
bound to your package name **and** your signing certificate, and (since Sept
2026) the only way to get on it is a declaration in the Play Console. Until
it's approved, testers hit "Health Connect blocked this app" the moment they
tap Read.

**Timeline: ~7 days for approval, then 5–7 business days for the whitelist to
propagate to Health Connect servers. Start this the day you have a package
name.**

## 1. Prerequisites

- [ ] A **Play Console developer account** — $25 one-time (register at
      play.google.com/console). If you already publish anything, you have one.
- [ ] A **package name** for the app — already set in `native/app.json`:
      `app.rythm`. Don't change it after this (the allowlist keys on it).
- [ ] A **stable signing key** — if you build with EAS, your keystore lives in
      your Expo account and EAS reuses it automatically. That's the safest
      setup; keep every build on that one key.

## 2. Create the app entry (if you haven't)

1. Play Console → **All apps → Create app**.
2. Name: rythm (tester), default language, app or game: **App**.
3. Choose a free or paid listing — for a tester-only round you can keep it
   unpublished; the declaration does not require a store listing.

## 3. Submit the health-apps declaration

1. In your app's console page, open **App content** (or Policy → App content).
2. Find the **Health apps declaration** section (it may appear as "Health
   Connect" under Data safety / Government apps; the exact menu item is
   "Health Connect" under **App content → Health apps declaration**).
3. Answer the questionnaire:
   - Declare that the app **reads** health data.
   - Select the data types you actually read. Keep it to what
     `native/src/healthconnect.ts` requests (Google shows users this exact
     list):
     - Heart rate
     - Resting heart rate
     - Heart rate variability
     - Steps
     - Total calories burned
     - Active calories burned
     - Sleep
     - Oxygen saturation
     - Body temperature
     - Exercise
   - State the purpose (recovery & strain scoring, training coaching) and that
     data stays on-device by default.
4. Submit. Play review takes **up to ~7 days**.

## 4. While you wait — testing on your own device

You don't have to sit idle. As the developer you can validate the full flow on
your own phone before the allowlist lands:

1. Build the APK (`npx eas build -p android --profile preview`).
2. Install it on your device (allow "install unknown apps" for the source).
3. Run the read flow. If the permission dialog appears and works → the
   pipeline is fine, and the only missing piece is the whitelist propagation.

If Health Connect blocks *you* too (no developer testing access for your
account), it means the declaration must complete first — the app code is not
the problem.

## 5. After approval

- Whitelist propagation takes **5–7 business days** after approval. Testers may
  see a delay window where some devices get access before others.
- Once propagated, testers open the app → Read → Health Connect permission
  dialog → grant → data flows. They can also manage/revoke access in the
  Health Connect app (Permissions → rythm).

## 6. The two mistakes that cost a week each

1. **Changing the package name** after declaring it → the allowlist no longer
   matches → restart the clock.
2. **Building with a different signing key** (e.g. sideloading a debug build)
   → the certificate doesn't match the declared app → Health Connect treats it
   as a different app. Always build via EAS so the keystore stays the same.

## 7. How to confirm it worked

- In the app: the error text "Health Connect blocked this app (not allowlisted
  yet)" disappears and the permission dialog opens instead. (The tester build
  shows this exact error when the allowlist is missing — see
  `native/src/healthconnect.ts`.)
- In Supabase: rows appear in `health_samples` after the tester syncs.
