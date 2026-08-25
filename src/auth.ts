// ---------------------------------------------------------------------------
// Auth — Google sign-in + email/password (demo), persisted in localStorage.
//
// Deployment note: the *real* Google flow uses Google Identity Services and
// is enabled the moment you set VITE_GOOGLE_CLIENT_ID (see .env.example). The
// ID token is decoded client-side for the demo; in production you should
// verify it on your backend (e.g. Google's tokeninfo endpoint or the
// google-auth-library) before trusting it — see README "Deployment".
//
// Without a client ID the app runs in demo mode: "Sign in with Google" opens
// an account chooser preloaded with a demo Google account, and email/password
// accounts are stored locally. Everything downstream is identical.
// ---------------------------------------------------------------------------

export interface AuthUser {
  name: string;
  email: string;
  picture?: string;
  provider: "google" | "email";
  signedInAt: string;
}

export interface StoredAccount {
  name: string;
  email: string;
  password: string; // demo only — never do this in production
  createdAt: string;
}

const AUTH_KEY = "rythm-auth";
const ACCOUNTS_KEY = "rythm-accounts";
const DEMO_ACCOUNT: StoredAccount = {
  name: "Alex Rivera",
  email: "alex.rivera@gmail.com",
  password: "demo",
  createdAt: new Date().toISOString(),
};

export const DEMO_GOOGLE_USERS: AuthUser[] = [
  {
    name: "Alex Rivera",
    email: "alex.rivera@gmail.com",
    picture: undefined,
    provider: "google",
    signedInAt: new Date().toISOString(),
  },
  {
    name: "Sam Patel",
    email: "sam.patel@gmail.com",
    picture: undefined,
    provider: "google",
    signedInAt: new Date().toISOString(),
  },
];

export function hasGoogleClient(): boolean {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
  return id.trim().length > 0;
}

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id: {
          initialize: (cfg: {
            client_id: string;
            use_fedcm_for_prompt?: boolean;
            callback: (resp: { credential: string }) => void;
          }) => void;
          prompt: () => void;
          renderButton: (el: HTMLElement, opts: unknown) => void;
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;

export function loadGoogleIdentity(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google Identity Services (offline?)"));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Decode a Google ID token payload (demo: client-side; verify server-side in prod). */
export function decodeGoogleCredential(credential: string): AuthUser | null {
  try {
    const payload = credential.split(".")[1];
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
      )
    );
    if (!json.email) return null;
    return {
      name: json.name ?? json.email.split("@")[0],
      email: json.email,
      picture: json.picture,
      provider: "google",
      signedInAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

export function loadAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    if (!u?.name || !u?.email) return null;
    return u;
  } catch {
    return null;
  }
}

export function saveAuth(u: AuthUser): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(u));
  } catch {
    /* storage unavailable — session just won't persist */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

export function loadAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const list = raw ? (JSON.parse(raw) as StoredAccount[]) : [];
    return [DEMO_ACCOUNT, ...list.filter((a) => a.email !== DEMO_ACCOUNT.email)];
  } catch {
    return [DEMO_ACCOUNT];
  }
}

function saveAccounts(list: StoredAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Remove a locally-stored account (Delete account). Demo account re-seeds. */
export function removeAccount(email: string): void {
  try {
    const list = loadAccounts().filter((a) => a.email.toLowerCase() !== email.toLowerCase());
    saveAccounts(list);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// email/password (demo accounts, stored locally)
// ---------------------------------------------------------------------------

export function signUpEmail(name: string, email: string, password: string): { ok: true; user: AuthUser } | { ok: false; error: string } {
  const list = loadAccounts();
  const em = email.trim().toLowerCase();
  if (!name.trim()) return { ok: false, error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { ok: false, error: "That email doesn't look right." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  if (list.some((a) => a.email.toLowerCase() === em))
    return { ok: false, error: "An account with that email already exists — sign in instead." };
  const account: StoredAccount = { name: name.trim(), email: em, password, createdAt: new Date().toISOString() };
  saveAccounts([...list, account]);
  return { ok: true, user: { name: account.name, email: account.email, provider: "email", signedInAt: new Date().toISOString() } };
}

export function signInEmail(email: string, password: string): { ok: true; user: AuthUser } | { ok: false; error: string } {
  const list = loadAccounts();
  const em = email.trim().toLowerCase();
  const account = list.find((a) => a.email.toLowerCase() === em);
  if (!account) return { ok: false, error: "No account found with that email." };
  if (account.password !== password) return { ok: false, error: "Wrong password." };
  return { ok: true, user: { name: account.name, email: account.email, provider: "email", signedInAt: new Date().toISOString() } };
}
