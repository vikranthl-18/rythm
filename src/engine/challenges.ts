// ---------------------------------------------------------------------------
// Group challenges — club-style goals with friends. A challenge picks a metric
// (distance / strain / sessions), a target and a window; progress is summed
// from each member's workouts over that window (your workouts locally,
// friends' workouts from their synced profiles). Local-first in v1: the
// challenge itself lives on your device.
// ---------------------------------------------------------------------------

import type { Friend, Workout } from "../types";

export type ChallengeMetric = "distanceKm" | "strain" | "sessions";

export interface Challenge {
  id: string;
  title: string;
  icon: string;
  metric: ChallengeMetric;
  target: number;
  days: number; // window length
  startIso: string; // YYYY-MM-DD
  createdBy: string; // creator's email
  memberEmails: string[]; // includes the creator
  createdAt: string;
}

export interface ChallengeMember {
  email: string;
  name: string;
  avatar?: string;
  color: string;
  isMe: boolean;
  value: number;
  pct: number;
}

export interface ChallengeProgress {
  challenge: Challenge;
  endIso: string;
  members: ChallengeMember[];
}

export const CHALLENGE_METRIC_META: Record<ChallengeMetric, { label: string; unit: string; icon: string }> = {
  distanceKm: { label: "Distance", unit: "km", icon: "📏" },
  strain: { label: "Strain", unit: "", icon: "🔥" },
  sessions: { label: "Sessions", unit: "", icon: "🏃" },
};

export const CHALLENGE_ICONS = ["🥇", "🏆", "💪", "🚀", "🔥", "🎯"];

/** Window end (inclusive) = start + days - 1. */
export function challengeEndIso(c: Challenge): string {
  const d = new Date(c.startIso + "T00:00:00");
  d.setDate(d.getDate() + c.days - 1);
  return d.toISOString().slice(0, 10);
}

export function challengeIsActive(c: Challenge, todayIso: string): boolean {
  return c.startIso <= todayIso && challengeEndIso(c) >= todayIso;
}

function inWindow(iso: string, startIso: string, endIso: string): boolean {
  const d = iso.slice(0, 10);
  return d >= startIso && d <= endIso;
}

/** A member's raw progress value from their workouts in the window. */
export function workoutsValue(
  workouts: Workout[],
  metric: ChallengeMetric,
  startIso: string,
  endIso: string
): number {
  let v = 0;
  for (const w of workouts) {
    if (!inWindow(w.startIso, startIso, endIso)) continue;
    if (metric === "distanceKm") v += w.distanceM / 1000;
    else if (metric === "strain") v += w.strain;
    else v += 1; // sessions
  }
  return Math.round(v * 10) / 10;
}

/** Progress for every member (you first), given your workouts + friends. */
export function buildChallengeProgress(
  c: Challenge,
  myEmail: string,
  myWorkouts: Workout[],
  friends: Friend[]
): ChallengeProgress {
  const endIso = challengeEndIso(c);
  const byEmail = new Map(friends.map((f) => [f.email, f]));
  const members: ChallengeMember[] = c.memberEmails.map((email) => {
    const isMe = email === myEmail;
    const friend = byEmail.get(email);
    const name = isMe ? "You" : (friend?.name ?? email.split("@")[0]);
    const workouts = isMe ? myWorkouts : (friend?.workouts ?? []);
    const value = workoutsValue(workouts, c.metric, c.startIso, endIso);
    return {
      email,
      name,
      avatar: isMe ? undefined : friend?.avatar,
      color: isMe ? "#bd4444" : (friend?.color ?? "#8b7cf6"),
      isMe,
      value,
      pct: Math.min(100, Math.round((value / Math.max(1, c.target)) * 100)),
    };
  });
  members.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : b.value - a.value));
  return { challenge: c, endIso, members };
}

export function makeChallenge(input: {
  title: string;
  icon: string;
  metric: ChallengeMetric;
  target: number;
  days: number;
  createdBy: string;
  memberEmails: string[];
}): Challenge {
  return {
    id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim(),
    icon: input.icon,
    metric: input.metric,
    target: input.target,
    days: Math.max(1, Math.min(90, Math.round(input.days))),
    startIso: new Date().toISOString().slice(0, 10),
    createdBy: input.createdBy,
    memberEmails: [input.createdBy, ...new Set(input.memberEmails.filter((e) => e && e !== input.createdBy))],
    createdAt: new Date().toISOString(),
  };
}
