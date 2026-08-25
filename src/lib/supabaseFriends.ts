// ---------------------------------------------------------------------------
// Real friends backend — the client side of supabase/migrations/0002_friends.sql.
//
// When the app is configured with Supabase AND the user has a live session,
// the social layer routes through these RPCs instead of the local simulated
// directory. All writes go through security-definer functions on the server
// that re-check auth.uid(); the client never touches the tables directly.
//
// Availability rules:
//   * cloudFriendsAvailable() — true when Supabase is configured + signed in.
//   * Demo accounts (alex.rivera@gmail.com etc.) never use the cloud — they
//     keep the local simulated directory so the demo works offline.
// ---------------------------------------------------------------------------

import { supabase, supabaseAvailable } from "./supabase";
import { isDemoEmail } from "../data/seed";
import type { Friend, FriendRequest, FriendRequestStatus } from "../types";

/** Whether a real cross-account friends flow can run right now. */
export function cloudFriendsAvailable(currentEmail: string): boolean {
  if (!supabaseAvailable || !supabase) return false;
  if (isDemoEmail(currentEmail)) return false;
  return true; // session is checked per-call (auth.uid() is null → RPC error)
}

interface CloudProfile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  goal: string | null;
  joined_at?: string;
}

interface CloudRequest {
  id: string;
  from_user?: string;
  to_user?: string;
  email: string;
  name: string;
  avatar_url: string | null;
  note: string | null;
  created_at: string;
}

const COLOR_PALETTE = ["#bd4444", "#73976a", "#c98a2d", "#f472b6", "#60a5fa", "#c084fc"];

function colorFor(seedKey: string): string {
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) h = (h * 31 + seedKey.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

/** Map a cloud profile row onto the app's DirectoryUser-ish shape (subset). */
export interface CloudPerson {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  goal: string;
  color: string;
  joinedAt: string;
}

export function toCloudPerson(p: CloudProfile): CloudPerson {
  return {
    id: p.id,
    email: p.email,
    name: p.name,
    avatar: p.avatar_url ?? undefined,
    goal: p.goal ?? "General fitness",
    color: colorFor(p.email),
    joinedAt: p.joined_at ?? new Date().toISOString(),
  };
}

/** Map a cloud request row onto the app's FriendRequest shape. */
export function toRequest(r: CloudRequest, me: string, direction: "in" | "out"): FriendRequest {
  return {
    id: r.id,
    fromEmail: direction === "in" ? r.email : me,
    fromName: direction === "in" ? r.name : "You",
    fromEmoji: "🙋",
    fromColor: direction === "in" ? colorFor(r.email) : "#bd4444",
    fromAvatar: r.avatar_url ?? undefined,
    toEmail: direction === "in" ? me : r.email,
    status: "pending" as FriendRequestStatus,
    sentAt: r.created_at,
    note: r.note ?? undefined,
  };
}

/** A cloud friend mapped to the app's Friend (workouts stay local/empty for now). */
export function toFriend(p: CloudProfile): Friend {
  const person = toCloudPerson(p);
  return {
    id: p.id,
    name: person.name,
    email: person.email,
    joinedAt: person.joinedAt,
    emoji: "🏃",
    color: person.color,
    avatar: person.avatar,
    goal: person.goal,
    workouts: [],
  };
}

// --- RPC wrappers ------------------------------------------------------------

type RpcResult = { ok: true } | { ok: false; error: string };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  if (!supabase) return { data: null, error: "Cloud sync is not configured." };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

export async function sendRequestCloud(
  toEmail: string,
  note?: string
): Promise<RpcResult & { id?: string }> {
  const res = await rpc<{ ok: boolean; error?: string | null; id?: string }>("send_friend_request", {
    p_to_email: toEmail,
    p_note: note ?? null,
  });
  if (res.error) return { ok: false, error: res.error };
  const body = res.data!;
  if (!body.ok) return { ok: false, error: body.error ?? "Couldn't send that request." };
  return { ok: true, id: body.id };
}

export async function acceptRequestCloud(requestId: string): Promise<RpcResult> {
  const res = await rpc<{ ok: boolean; error?: string | null }>("accept_friend_request", {
    p_request_id: requestId,
  });
  if (res.error) return { ok: false, error: res.error };
  const body = res.data!;
  return body.ok ? { ok: true } : { ok: false, error: body.error ?? "Couldn't accept." };
}

export async function declineRequestCloud(requestId: string): Promise<RpcResult> {
  const res = await rpc<{ ok: boolean; error?: string | null }>("decline_friend_request", {
    p_request_id: requestId,
  });
  if (res.error) return { ok: false, error: res.error };
  const body = res.data!;
  return body.ok ? { ok: true } : { ok: false, error: body.error ?? "Couldn't decline." };
}

export async function removeFriendCloud(friendId: string): Promise<RpcResult> {
  const res = await rpc<{ ok: boolean; error?: string | null }>("remove_friend", {
    p_friend_id: friendId,
  });
  if (res.error) return { ok: false, error: res.error };
  const body = res.data!;
  return body.ok ? { ok: true } : { ok: false, error: body.error ?? "Couldn't remove." };
}

export async function fetchFriendsCloud(): Promise<CloudProfile[]> {
  const res = await rpc<CloudProfile[]>("friends_of", {});
  return res.data ?? [];
}

export async function fetchIncomingCloud(): Promise<CloudRequest[]> {
  const res = await rpc<CloudRequest[]>("incoming_requests", {});
  return res.data ?? [];
}

export async function fetchOutgoingCloud(): Promise<CloudRequest[]> {
  const res = await rpc<CloudRequest[]>("outgoing_requests", {});
  return res.data ?? [];
}

/** Search real accounts by name or email (used by the Add-friend search box). */
export async function searchUsersCloud(q: string): Promise<CloudPerson[]> {
  if (!q.trim()) return [];
  const res = await rpc<CloudProfile[]>("search_users", { p_q: q.trim() });
  return (res.data ?? []).map(toCloudPerson);
}

/** Contacts matching: pass normalized contact phone digits, get back matches. */
export async function lookupPhonesCloud(phones: string[]): Promise<CloudPerson[]> {
  const digits = phones.map((p) => p.replace(/\D/g, "")).filter((p) => p.length >= 7);
  if (digits.length === 0) return [];
  const res = await rpc<CloudProfile[]>("lookup_phones", { p_phones: digits });
  return (res.data ?? []).map(toCloudPerson);
}
