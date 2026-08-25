// ---------------------------------------------------------------------------
// Friends — domain logic for the social layer. Friends are accounts: you send
// a request to someone's email, they accept it, and only then does their
// profile + workouts appear in your list. (Web demo keeps everything
// client-side; the pure functions here port straight to the React Native app
// with a real friends API behind them.)
// ---------------------------------------------------------------------------

import type { Friend, FriendRequest } from "../types";
import { USER_DIRECTORY, genFriendWorkouts, type DirectoryUser } from "../data/seed";
import { loadAccounts } from "../auth";
import { uid } from "../lib/rng";

/**
 * Everyone the current user can send a request to: the public directory plus
 * any locally-registered email accounts — minus the user themself.
 */
export function directoryFor(currentEmail: string): DirectoryUser[] {
  const me = currentEmail.toLowerCase();
  const accounts: DirectoryUser[] = loadAccounts()
    .filter((a) => a.email.toLowerCase() !== me)
    .map((a) => ({
      email: a.email,
      name: a.name,
      emoji: "🏃",
      color: "#9a8b7c",
      goal: "General fitness",
      seed: Math.floor(Math.random() * 1e9),
      joinedAt: a.createdAt,
    }));
  const seen = new Set<string>();
  return [...USER_DIRECTORY, ...accounts].filter((d) => {
    const k = d.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Returns an error message if the request can't be sent, or null when it's
 * valid. Kept pure so the store action and the UI share one source of truth.
 */
export function validateSendRequest(
  targetEmail: string,
  currentEmail: string,
  friends: Friend[],
  requests: FriendRequest[],
  directory: DirectoryUser[]
): string | null {
  const t = targetEmail.trim().toLowerCase();
  if (!t) return "Enter an email address.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return "That email doesn't look right.";
  if (t === currentEmail.toLowerCase()) return "That's you — you can't friend yourself.";
  if (!directory.some((d) => d.email.toLowerCase() === t))
    return "No rythm account found with that email.";
  if (friends.some((f) => f.email.toLowerCase() === t))
    return "You're already friends with them.";
  if (
    requests.some(
      (r) => r.fromEmail.toLowerCase() === t && r.status === "pending"
    )
  )
    return "A request is already pending with them.";
  return null;
}

/** Turn an accepted request into a full friend profile (with their history). */
export function buildFriendFromRequest(req: FriendRequest): Friend {
  const id = uid("fr");
  const u = USER_DIRECTORY.find((d) => d.email.toLowerCase() === req.fromEmail.toLowerCase());
  const seed = u?.seed ?? Math.floor(Math.random() * 1e9);
  return {
    id,
    name: u?.name ?? (req.fromName || "Friend"),
    email: req.fromEmail,
    joinedAt: u?.joinedAt ?? new Date().toISOString(),
    emoji: u?.emoji ?? (req.fromEmoji || "🏃"),
    color: u?.color ?? (req.fromColor || "#9a8b7c"),
    avatar: u?.avatar ?? req.fromAvatar,
    goal: u?.goal ?? "General fitness",
    workouts: genFriendWorkouts(seed, id),
  };
}

/**
 * Find a directory user by phone number (normalized). Used for the manual
 * "find by phone" path and to map contact picks onto real accounts.
 */
export function findByPhone(directory: DirectoryUser[], phone: string): DirectoryUser | null {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  return (
    directory.find((d) => d.phone && normalizePhone(d.phone) === norm) ?? null
  );
}

/**
 * Canonical phone key for matching: digits only, and a leading US/CA country
 * code (11 digits starting with 1) is dropped so "+1 415 555 0131" and
 * "(415) 555-0131" match each other.
 */
export function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export function handleOf(email: string): string {
  return `@${email.split("@")[0] ?? ""}`;
}
