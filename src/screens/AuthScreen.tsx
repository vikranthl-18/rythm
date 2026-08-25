import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  DEMO_GOOGLE_USERS,
  decodeGoogleCredential,
  hasGoogleClient,
  loadGoogleIdentity,
  signInEmail,
  signUpEmail,
  type AuthUser,
} from "../auth";
import LegalSheet, { type LegalDoc } from "../components/LegalSheet";
import { APP_VERSION } from "../lib/version";
import { authUserFromSession, supabase, supabaseAvailable } from "../lib/supabase";

/** Human-friendly messages for common Supabase Auth errors. */
function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("already registered")) return "An account with that email already exists — sign in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first (we sent you a link), then sign in.";
  if (m.includes("rate limit")) return "Too many attempts — wait a moment and try again.";
  if (m.includes("password")) return "Password must be at least 6 characters.";
  if (m.includes("identity_already_exists") || m.includes("already linked to another"))
    return "This Google account's email already has a rythm account with a password — sign in with that email and password instead (or use a different Google account).";
  if (m.includes("redirect"))
    return "Google sign-in was rejected: your site's address isn't in Supabase's allowed Redirect URLs. Tap \"Google sign-in not working?\" below for the exact fix.";
  if (m.includes("provider"))
    return "Google isn't enabled yet in Supabase — turn it on under Authentication → Providers → Google.";
  if (m.includes("oauth state") || m.includes("state parameter"))
    return "The sign-in attempt expired or was replayed — tap Continue with Google again.";
  if (m.includes("temporarily_unavailable") || m.includes("server_error"))
    return "Google had a temporary hiccup — try again in a minute.";
  return msg;
}

function currentOrigin(): string {
  if (typeof window === "undefined" || !window.location) return "";
  return window.location.origin;
}

/**
 * Origins the Google client ID is authorized for (VITE_AUTHORIZED_ORIGINS,
 * comma-separated, e.g. "http://localhost:5173,https://your-app.com").
 * When the list is set and the current origin isn't in it, Google will reject
 * the button with "Error 400: invalid_request" in the popup — so we don't
 * even render the real button; we show the fix panel + demo chooser instead.
 * When the list is empty we can't know, so we keep the timeout heuristic.
 */
function authorizedOrigins(): string[] {
  const raw = (import.meta.env.VITE_AUTHORIZED_ORIGINS as string | undefined) ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean);
}

function originAllowed(): boolean {
  const list = authorizedOrigins();
  if (list.length === 0) return true; // unset — fall back to the timeout heuristic
  const o = currentOrigin().toLowerCase().replace(/\/$/, "");
  return list.includes(o);
}

const G_LOGO = (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden>
    <path
      fill="#4285F4"
      d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.86Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.43-3.43A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.76 12 4.76Z"
    />
  </svg>
);

export default function AuthScreen() {
  const s = useStore();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState(false);
  // With Supabase configured, Google goes through Supabase Auth (server-side
  // token verification) — the client-side GIS button only runs without it.
  const [realGoogle, setRealGoogle] = useState(hasGoogleClient() && !supabaseAvailable);
  const [gisNote, setGisNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [popupHint, setPopupHint] = useState(false);
  const [consent, setConsent] = useState(false);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  // Passwordless email-code sign-in (no popups, no redirects — works inside
  // embedded webviews where Google OAuth can't navigate). Supabase emails a
  // 6-digit code; verifyOtp swaps it for a full session.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const origin = currentOrigin();
  const originBlocked = hasGoogleClient() && !originAllowed();

  // Surface OAuth failures that supabase-js silently swallows: when the
  // Google handshake fails after the redirect back (bad state, identity
  // already linked to another account, provider error), GoTrue sends the app
  // back with ?error=...&error_description=...&error_code=... and this
  // version of supabase-js drops them. Show the real cause instead of a
  // silent return to the form, then clean the URL so a refresh doesn't
  // re-show the stale error.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      const desc = params.get("error_description");
      const code = params.get("error_code");
      if (err || desc || code) {
        const detail = desc || `error ${err || code || "unspecified"}`;
        setError(friendlyAuthError(detail));
        const url = new URL(window.location.href);
        url.searchParams.delete("error");
        url.searchParams.delete("error_description");
        url.searchParams.delete("error_code");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      /* URL unavailable — nothing to surface */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const googleBtn = useRef<HTMLDivElement>(null);
  const popupSeen = useRef(false);

  // Real accounts via Supabase Auth when configured; local demo accounts
  // otherwise. Supabase verifies Google tokens on its auth server and stores
  // passwords hashed — the local path only exists for the no-backend demo.
  const submit = async () => {
    setError(null);
    if (mode === "signup" && !consent) {
      setError("Please accept the Privacy Policy and Terms to create an account.");
      return;
    }
    setBusy(true);
    if (supabaseAvailable && supabase) {
      try {
        if (mode === "signup") {
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { name: name.trim() } },
          });
          if (error) return setError(friendlyAuthError(error.message));
          if (data.session) {
            const u = authUserFromSession(data.session);
            if (u) s.setAuth(u);
          } else {
            setError(
              "Check your email to confirm your account, then sign in — email confirmation is on for new accounts."
            );
          }
        } else {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) return setError(friendlyAuthError(error.message));
          if (data.session) {
            const u = authUserFromSession(data.session);
            if (u) s.setAuth(u);
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    // Local demo path (no Supabase env vars).
    setTimeout(() => {
      const res =
        mode === "signup"
          ? signUpEmail(name, email, password)
          : signInEmail(email, password);
      setBusy(false);
      if (res.ok) s.setAuth(res.user);
      else setError(res.error);
    }, 350);
  };

  // Supabase OAuth — Google tokens are verified server-side by Supabase Auth.
  // Passwordless: email a 6-digit sign-in code (signInWithOtp). Only for
  // existing accounts — shouldCreateUser:false so a typo'd email errors
  // instead of silently creating a new account.
  const sendCode = async () => {
    setError(null);
    const addr = email.trim();
    if (!addr) {
      setError("Enter your email first.");
      return;
    }
    if (!supabase) {
      setError("Email codes need the app connected to its backend — Google sign-in works instead.");
      return;
    }
    setCodeBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: addr,
        options: { shouldCreateUser: false },
      });
      if (error) setError(friendlyAuthError(error.message));
      else setCodeSent(true);
    } catch (e) {
      setError(`Couldn't send the code: ${String(e)}`);
    }
    setCodeBusy(false);
  };

  const verifyCode = async () => {
    setError(null);
    if (!supabase) return;
    setCodeBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (error) setError(friendlyAuthError(error.message));
      else if (data.session) {
        const u = authUserFromSession(data.session);
        if (u) s.setAuth(u);
      }
    } catch (e) {
      setError(`Couldn't verify the code: ${String(e)}`);
    }
    setCodeBusy(false);
  };

  const supabaseGoogle = async () => {
    if (mode === "signup" && !consent) {
      setError("Accept the Privacy Policy and Terms to continue.");
      return;
    }
    if (!supabase) return;

    // Inside the APK's WebView (native shell), Google refuses embedded
    // WebView sign-in and can't see the phone's accounts — so the native
    // shell runs the OAuth in a Chrome Custom Tab and injects the session
    // back. Detect the shell and hand off instead of doing browser OAuth.
    const rn = (window as unknown as {
      ReactNativeWebView?: { postMessage?: (m: string) => void };
      __rythmOAuthDone?: (r: { ok: boolean; error?: string }) => void;
    }).ReactNativeWebView;
    if (rn?.postMessage) {
      setBusy(true);
      setError(null);
      (window as unknown as { __rythmOAuthDone: (r: { ok: boolean; error?: string }) => void }).__rythmOAuthDone = (
        r: { ok: boolean; error?: string }
      ) => {
        setBusy(false);
        if (!r.ok) setError(r.error || "Google sign-in failed — try again.");
      };
      rn.postMessage(JSON.stringify({ __rythmOAuth: { type: "google" } }));
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        // Log the full shape — status/code/message — so the console shows the
        // real cause even when the on-screen text is generic.
        const details = error as { status?: number; code?: string };
        console.error("rythm: Google OAuth failed", {
          message: error.message,
          status: details.status,
          code: details.code,
        });
        setBusy(false);
        setError(friendlyAuthError(error.message));
        return;
      }
      void data; // success → the browser navigates to Google; the session
      // listener in App completes the sign-in when we land back on redirectTo.
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setError(`Google sign-in failed: ${String(e)}`);
    }
  };

  const google = async (u: AuthUser) => {
    if (mode === "signup" && !consent) {
      setError("Please accept the Privacy Policy and Terms to continue.");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setChooser(false);
      s.setAuth(u);
    }, 400);
  };

  // Real Google Identity Services flow (only when VITE_GOOGLE_CLIENT_ID is set).
  // Runs exactly once on mount: the store re-renders on every sim tick, and a
  // `s` dependency here would re-initialize GIS + re-render the button dozens
  // of times (Google rate-limits the iframe — 403 spam). setAuth is a stable
  // zustand action, so capturing it from the first render is safe.
  useEffect(() => {
    // If we already know this origin isn't authorized, don't initialize GIS at
    // all — the button would only 400 in the popup. Show the fix panel instead.
    if (!hasGoogleClient() || supabaseAvailable || originBlocked || !googleBtn.current) return;
    const setAuth = s.setAuth;
    let cancelled = false;
    let renderCheck: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        await loadGoogleIdentity();
        if (cancelled || !googleBtn.current) return;
        window.google?.accounts?.id.initialize({
          client_id: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ?? "",
          // FedCM (native browser prompt) avoids the popup + third-party-cookie
          // handshake entirely where the browser supports it (Chrome/Edge 108+,
          // Safari 17+) — no popups, no blank pages after choosing an account.
          use_fedcm_for_prompt: true,
          callback: (resp) => {
            popupSeen.current = false;
            const u = decodeGoogleCredential(resp.credential);
            if (u) setAuth(u);
            else setError("Google sign-in failed — try the demo account instead.");
          },
        });
        window.google?.accounts?.id.renderButton(googleBtn.current, {
          theme: "outline",
          size: "large",
          width: 340,
          shape: "pill",
          text: "continue_with",
        });
        // GIS has no failure callback (Google issue #241295996) — the documented
        // workaround is a timeout. If the button never appears (script blocked,
        // origin rejected), fall back to the demo chooser with an explanation.
        renderCheck = setTimeout(() => {
          if (cancelled || !googleBtn.current) return;
          if (googleBtn.current.childElementCount === 0) {
            setRealGoogle(false);
            setGisNote(
              `The Google button couldn't render on ${origin || "this origin"} — Google rejected it (the origin isn't in the client ID's authorized JavaScript origins). Showing the offline demo chooser instead. To enable real sign-in, add the origin below in Google Cloud Console.`
            );
          }
        }, 4000);
      } catch {
        if (!cancelled) setRealGoogle(false); // fall back to demo chooser
      }
    })();
    return () => {
      cancelled = true;
      if (renderCheck) clearTimeout(renderCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect the classic GIS popup failure: the Google window opens (this page
  // loses focus) but the credential never comes back — the user picks an
  // account and lands on a blank page. That's the browser blocking Google's
  // third-party cookie handshake. Explain it and point to the alternatives.
  useEffect(() => {
    if (!realGoogle || !hasGoogleClient() || originBlocked) return;
    const onBlur = () => {
      popupSeen.current = true;
    };
    const onFocus = () => {
      if (popupSeen.current && !useStore.getState().auth) setPopupHint(true);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [realGoogle, originBlocked]);

  const gisFixBlock = origin ? (
    <div className="gis-fix">
      <div className="gis-fix-row">
        <code className="gis-origin">{origin}</code>
        <button
          className="gis-copy"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(origin);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable — the text is selectable */
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <ol className="gis-steps">
        <li>
          Open <b>Google Cloud Console</b> → <b>APIs &amp; Services</b> → <b>Credentials</b>.
        </li>
        <li>
          Click the OAuth client for this app (ID ends in <code>apps.googleusercontent.com</code>).
        </li>
        <li>
          Under <b>Authorized JavaScript origins</b>, add the origin above — and{" "}
          <code>http://localhost:5173</code> for local dev.
        </li>
        <li>Save, then hard-refresh this page and the real button appears.</li>
      </ol>
    </div>
  ) : null;

  // Supabase-mode fix panel: the most common 400 is the redirect URL not
  // being allowed, or Google not being enabled in the dashboard.
  const supabaseFixBlock = origin ? (
    <div className="gis-fix">
      <div className="gis-fix-row">
        <code className="gis-origin">{origin}</code>
        <button
          className="gis-copy"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(origin);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable — the text is selectable */
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <ol className="gis-steps">
        <li>
          Open <b>Supabase</b> → <b>Authentication</b> → <b>URL Configuration</b>.
        </li>
        <li>
          Under <b>Redirect URLs</b>, add the origin above — and{" "}
          <code>http://localhost:5173</code> for local dev (wildcards like{" "}
          <code>https://your-app.com/**</code> work too).
        </li>
        <li>
          Check <b>Authentication</b> → <b>Providers</b> → <b>Google</b> is
          enabled (leave Client ID / Secret empty to use Supabase's app).
        </li>
        <li>Save, then try signing in again.</li>
      </ol>
    </div>
  ) : null;

  const googleBlock = (
    <div className="auth-google">
      {realGoogle && hasGoogleClient() && !originBlocked ? (
        // The GIS div stays mounted from the start (GIS initializes once on
        // mount — unmounting it would kill the button). Until consent is given
        // in signup mode, an opaque cover button sits on top of it.
        <div className="auth-gis-wrap">
          <div ref={googleBtn} className="auth-gis" />
          {!(consent || mode === "signin") && (
            <button
              className="auth-google-btn auth-gis-cover"
              onClick={() => setError("Accept the Privacy Policy and Terms below first.")}
              disabled={busy}
            >
              <span className="g-logo">{G_LOGO}</span>
              Continue with Google
            </button>
          )}
        </div>
      ) : supabaseAvailable ? (
        <button className="auth-google-btn" onClick={() => void supabaseGoogle()} disabled={busy}>
          <span className="g-logo">{G_LOGO}</span>
          {busy ? "Connecting…" : "Continue with Google"}
        </button>
      ) : (
        <button
          className="auth-google-btn"
          onClick={() => (mode === "signup" && !consent ? setError("Accept the Privacy Policy and Terms below first.") : setChooser(true))}
          disabled={busy}
        >
          <span className="g-logo">{G_LOGO}</span>
          Continue with Google
        </button>
      )}
      {supabaseAvailable && (
        <>
          <p className="hint" style={{ margin: "8px 0 0" }}>
            Signing in with Google ·{" "}
            <span className="link" onClick={() => setChooser(true)}>
              use the demo chooser instead
            </span>
            {" · "}
            <span className="link" onClick={() => setFixOpen((o) => !o)}>
              {fixOpen ? "hide fix" : "Google sign-in not working?"}
            </span>
          </p>
          {fixOpen && supabaseFixBlock}
        </>
      )}
      {originBlocked && (
        <div className="auth-error" style={{ marginTop: 10, textAlign: "left" }}>
          <p style={{ margin: "0 0 8px" }}>
            Google rejected sign-in from <b>{origin || "this origin"}</b> with{" "}
            <b>error 400</b> — it isn&apos;t in the client ID&apos;s authorized JavaScript
            origins. Add it in Google Cloud Console (copy below), then hard-refresh. Until
            then, use the demo chooser to get in.
          </p>
          {gisFixBlock}
        </div>
      )}
      {realGoogle && hasGoogleClient() && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          Signing in with Google ·{" "}
          <span className="link" onClick={() => setRealGoogle(false)}>use the demo chooser instead</span>
          {origin && (
            <>
              {" · "}
              <span className="link" onClick={() => setFixOpen((o) => !o)}>
                {fixOpen ? "hide fix" : "Google sign-in not working?"}
              </span>
            </>
          )}
        </p>
      )}
      {gisNote && !realGoogle && (
        <div className="auth-error" style={{ marginTop: 10, textAlign: "left" }}>
          <p style={{ margin: "0 0 8px" }}>{gisNote}</p>
          {gisFixBlock}
        </div>
      )}
      {popupHint && realGoogle && !originBlocked && (
        <div className="auth-error" style={{ marginTop: 10, textAlign: "left" }}>
          <p style={{ margin: "0 0 8px" }}>
            The Google window opened but the sign-in didn&apos;t finish — if you picked an
            account and saw a blank page, your browser blocked Google&apos;s popup handshake
            (third-party cookies or a private window). Enable third-party cookies for this
            site and try again, or use the demo chooser / email below — they always work.
          </p>
          <button className="chip-btn sm" onClick={() => setChooser(true)}>
            Open the demo chooser
          </button>
        </div>
      )}
      {fixOpen && realGoogle && origin && gisFixBlock}
    </div>
  );

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo auth-logo">◢</span>
          <span className="auth-name">rythm</span>
        </div>
        <p className="auth-tagline">
          Recovery, strain &amp; coaching — the app that knows how hard you can push today.
        </p>

        {googleBlock}

        <div className="auth-divider">
          <span>or {mode === "signin" ? "sign in" : "sign up"} with email</span>
        </div>

        {mode === "signup" && (
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        {supabaseAvailable && mode === "signin" && !codeSent && (
          <button type="button" className="link-btn auth-code-link" onClick={() => void sendCode()} disabled={codeBusy}>
            {codeBusy ? "Sending…" : "Sign in with an email code instead (no password)"}
          </button>
        )}

        {codeSent && (
          <div className="auth-code">
            <p className="hint" style={{ marginTop: 0 }}>
              We emailed a sign-in link to <b>{email.trim()}</b>. If you got a link,
              open it <b>in this same browser</b> to finish signing in here. If you got a
              6-digit code instead, enter it below (check spam if neither arrives).
            </p>
            <label className="field">
              <span>6-digit code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && code.trim().length === 6 && verifyCode()}
              />
            </label>
            <button className="auth-submit" onClick={() => void verifyCode()} disabled={codeBusy || code.trim().length < 6}>
              {codeBusy ? "Checking…" : "Verify code"}
            </button>
            <p className="hint">
              Wrong email?{" "}
              <span
                className="link"
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                }}
              >
                start over
              </span>
            </p>
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}

        {mode === "signup" && (
          <label className="auth-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I agree to the{" "}
              <span className="link" onClick={() => setLegal("terms")}>
                Terms of Use
              </span>{" "}
              and{" "}
              <span className="link" onClick={() => setLegal("privacy")}>
                Privacy Policy
              </span>
            </span>
          </label>
        )}

        <button className="auth-submit" onClick={submit} disabled={busy}>
          {busy ? "One sec…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <p className="auth-switch">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <span
            className="link"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setCodeSent(false);
              setCode("");
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </span>
        </p>

        <p className="auth-note">
          Demo build v{APP_VERSION} — data stays in this browser. Try the demo Google account
          (Alex Rivera) or create any email account.
        </p>
        <p className="auth-legal">
          <span className="link" onClick={() => setLegal("privacy")}>
            Privacy Policy
          </span>
          {" · "}
          <span className="link" onClick={() => setLegal("terms")}>
            Terms of Use
          </span>
        </p>
      </div>

      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}

      {chooser && (
        <div className="sheet-overlay" onClick={() => setChooser(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div className="sheet-icon">{G_LOGO}</div>
              <h2>Choose an account</h2>
              <button className="sheet-close" onClick={() => setChooser(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="sheet-body">
              <p className="hint" style={{ marginTop: 0 }}>
                Demo of the Google account chooser (no network needed).
              </p>
              {DEMO_GOOGLE_USERS.map((u) => (
                <button key={u.email} className="gac-row" onClick={() => google(u)} disabled={busy}>
                  <span className="gac-avatar">{u.name.charAt(0)}</span>
                  <span className="gac-body">
                    <span className="gac-name">{u.name}</span>
                    <span className="gac-email">{u.email}</span>
                  </span>
                  <span className="gac-arrow">→</span>
                </button>
              ))}
              <button className="gac-row" onClick={() => setChooser(false)}>
                <span className="gac-avatar gac-plus">＋</span>
                <span className="gac-body">
                  <span className="gac-name">Use another account</span>
                  <span className="gac-email">Back to the sign-up form</span>
                </span>
                <span className="gac-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
