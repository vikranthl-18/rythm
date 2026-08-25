// ---------------------------------------------------------------------------
// Context-aware AI coach (Module 5)
//
// The coach builds a full physiological context (recovery, strain, sleep,
// habits, recent workouts, goal) and grounds every reply in it. Replies are
// currently produced by a deterministic rule engine so the demo runs fully
// offline — the assembly logic is exactly what you'd pass as the system
// prompt + tool context to an LLM (see buildSystemPrompt below).
// ---------------------------------------------------------------------------

import type { DailyMetrics, Habit, RecoveryColor, Workout } from "../types";
import { recoveryColor } from "../engine/recovery";
import { strainTarget } from "../engine/zones";
import { addDaysIso } from "../lib/rng";
import { fmtKm } from "../lib/geo";
import { completedOn, habitDueOn } from "./habits";

export interface CoachContext {
  goal: string;
  age: number;
  recovery: number;
  recoveryColor: RecoveryColor;
  strain: number;
  strainTarget: number;
  hrv: number;
  hrvBaseline: number;
  rhr: number;
  rhrBaseline: number;
  sleepScore: number;
  sleepMin: number;
  needMin: number;
  sleepDebtMin: number;
  steps: number;
  habits: { title: string; icon: string; done: boolean }[];
  habitsDone: number;
  habitsDue: number;
  weekMileageKm: number;
  weekSessions: number;
  weekStrain: number;
  workouts7: {
    title: string;
    when: string;
    durationMin: number;
    km: number;
    strain: number;
  }[];
}

export interface CoachInput {
  goal: string;
  age: number;
  today: DailyMetrics | null;
  strainNow: number;
  habits: Habit[];
  days: DailyMetrics[];
  workouts: Workout[];
  todayIso: string;
  /** false when the user disabled biometric habit auto-completion (default true) */
  autoHabits?: boolean;
}

export function buildCoachContext(i: CoachInput): CoachContext {
  const today = i.today;
  const recovery = today ? today.recovery : 50;
  const color = recoveryColor(recovery);
  const target = strainTarget(recovery);

  const hrvB = i.days.length ? i.days.reduce((a, d) => a + d.hrv, 0) / i.days.length : 0;
  const rhrB = i.days.length ? i.days.reduce((a, d) => a + d.restingHR, 0) / i.days.length : 0;

  // rolling 7-day window (whoop-style) so a Monday morning doesn't zero out
  const ws = addDaysIso(i.todayIso, -6);
  let mileage = 0;
  let sessions = 0;
  let strain = 0;
  for (const w of i.workouts) {
    if (w.startIso.slice(0, 10) >= ws) {
      mileage += w.distanceM / 1000;
      sessions++;
      strain += w.strain;
    }
  }

  const habits = i.habits
    .filter((h) => habitDueOn(h, i.todayIso))
    .map((h) => ({
      title: h.title,
      icon: h.icon,
      done: completedOn(h, i.todayIso, i.todayIso, today, { auto: i.autoHabits ?? true }),
    }));
  const habitsDue = habits.length;
  const habitsDone = habits.filter((h) => h.done).length;

  const workouts7 = [...i.workouts]
    .filter((w) => Date.now() - new Date(w.startIso).getTime() < 7 * 86400000)
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
    .map((w) => ({
      title: w.title,
      when: new Date(w.startIso).toLocaleDateString(undefined, { weekday: "short" }),
      durationMin: Math.round(w.durationSec / 60),
      km: w.distanceM / 1000,
      strain: w.strain,
    }));

  return {
    goal: i.goal,
    age: i.age,
    recovery,
    recoveryColor: color,
    strain: i.strainNow,
    strainTarget: target,
    hrv: today ? today.hrv : 0,
    hrvBaseline: hrvB,
    rhr: today ? today.restingHR : 0,
    rhrBaseline: rhrB,
    sleepScore: today ? today.sleep.score : 0,
    sleepMin: today ? today.sleep.durationMin : 0,
    needMin: today ? today.sleep.needMin : 450,
    sleepDebtMin: today ? Math.max(0, today.sleep.needMin - today.sleep.durationMin) : 0,
    steps: today ? today.steps : 0,
    habits,
    habitsDone,
    habitsDue,
    weekMileageKm: mileage,
    weekSessions: sessions,
    weekStrain: Math.round(strain * 10) / 10,
    workouts7,
  };
}


export const QUICK_PROMPTS = [
  "Why is my recovery low today?",
  "Suggest a workout based on my recovery",
  "How's my sleep debt looking?",
  "Am I on track for my goal this week?",
  "What should I focus on today?",
];

const colorAdj: Record<RecoveryColor, string> = {
  green: "Green — your body is primed to handle load",
  yellow: "Yellow — moderate readiness, keep it measured",
  red: "Red — high fatigue, today is a recovery day",
};

export function recommendWorkout(c: CoachContext): string {
  if (c.recoveryColor === "green") {
    return `Today's a quality day. Try: 15–20 min easy warm-up, then 3 × 6 min at threshold (~88% HRmax) with 3 min jog recoveries, 10 min cool-down. Aim to land around strain ${c.strainTarget.toFixed(1)} — your body can take it today.`;
  }
  if (c.recoveryColor === "yellow") {
    return `Keep it steady today: 40–50 min in Z2 (conversational pace) or a light strength session. Target strain ≈ ${c.strainTarget.toFixed(1)}. Save the hard intervals for a green day.`;
  }
  return `Honor the red: 20–30 min easy walk or Z1 mobility work, foam roll, hydrate, and prioritize sleep tonight. Strain target ≈ ${c.strainTarget.toFixed(1)}. The fitness you lose by resting is made up by the fatigue you don't stack.`;
}

export function morningBrief(c: CoachContext): string {
  const sleepNote =
    c.sleepDebtMin > 0
      ? `You're ${c.sleepDebtMin} min behind on sleep.`
      : `Sleep's on track.`;
  const habitNote =
    c.habitsDone >= c.habitsDue && c.habitsDue > 0
      ? "All habits are checked off."
      : `${c.habitsDue - c.habitsDone} habit${c.habitsDue - c.habitsDone === 1 ? "" : "s"} left today.`;
  return `${colorAdj[c.recoveryColor]} (${c.recovery}%). HRV is ${c.hrv} ms vs a ${c.hrvBaseline.toFixed(0)} ms baseline. ${sleepNote} ${recommendWorkout(c)} ${habitNote}`;
}

// ---------------------------------------------------------------------------
// Chat reply engine (rule-based, fully grounded in the context)
// ---------------------------------------------------------------------------

export function coachReply(raw: string, c: CoachContext): string {
  const text = raw.toLowerCase();

  if (/^(hi|hey|hello|yo|sup|morning)\b/.test(text)) {
    return `Hey! Today you're at ${c.recovery}% recovery (${c.recoveryColor}), strain ${c.strain.toFixed(1)} / ${c.strainTarget.toFixed(1)} target. ${recommendWorkout(c)}`;
  }

  // Specific intent wins over generic "recovery" mentions (e.g. "suggest a
  // workout based on my recovery" should recommend, not explain recovery).
  if (/suggest|recommend|what should i (do|train)|workout (today|now)|train today|how (should|can) i train/.test(text)) {
    return recommendWorkout(c);
  }

  if (/recovery|readiness|hrv|recover/.test(text)) {
    const hrvDelta = c.hrv - c.hrvBaseline;
    const parts = [
      `Your recovery is ${c.recovery}% (${c.recoveryColor}), driven by HRV ${c.hrv} ms (${hrvDelta >= 0 ? "+" : ""}${hrvDelta.toFixed(0)} vs your ${c.hrvBaseline.toFixed(0)} ms 7-day baseline), resting HR ${c.rhr} bpm, and a sleep score of ${c.sleepScore}.`,
    ];
    if (c.recoveryColor === "red") {
      parts.push(
        "The signals say your nervous system is still taxed. Skip hard sessions today, cap strain near " +
          c.strainTarget.toFixed(1) +
          ", and protect tonight's sleep window."
      );
    } else if (c.recoveryColor === "yellow") {
      parts.push(
        "You're neither fully fresh nor wiped — treat today as a maintenance day with one solid Z2 block."
      );
    } else {
      parts.push(
        "Everything's trending in your favor — this is the day to bank a quality workout."
      );
    }
    return parts.join(" ");
  }

  if (/sleep|tired|fatigue|low energy|exhaust/.test(text)) {
    const debt = c.sleepDebtMin;
    const dur = (c.sleepMin / 60).toFixed(1);
    const need = (c.needMin / 60).toFixed(1);
    const debtNote =
      debt > 0
        ? `You're ${debt} min short of your ${need} h need — that's carrying into today.`
        : `You're at/above your ${need} h need — good.`;
    return `Last night: ${dur} h vs a ${need} h need, sleep score ${c.sleepScore}. ${debtNote} Practically: keep caffeine before noon, hold a consistent bedtime, and keep strain near ${c.strainTarget.toFixed(1)} so tonight's sleep can do its job.`;
  }

  if (/strain|load|zone/.test(text)) {
    const left = Math.max(0, c.strainTarget - c.strain).toFixed(1);
    return `Today's strain: ${c.strain.toFixed(1)} of a ${c.strainTarget.toFixed(1)} target (targets are set by recovery: green ≈ 14.5, yellow ≈ 9.5, red ≈ 4). You have ~${left} strain left before I'd call today "hard". Workout strain counts double toward the cap, so pick the session that fits.`;
  }

  if (/habit|streak|routine|check/.test(text)) {
    const list =
      c.habits.length === 0
        ? "No habits due today."
        : c.habits
            .map((h) => `${h.done ? "✅" : "⬜"} ${h.icon} ${h.title}`)
            .join("\n");
    return `Habit check-in: ${c.habitsDone}/${c.habitsDue} done today.\n${list}\nStreaks reset when a due day slips, so knock out the easy ones early.`;
  }

  if (/week|plan|schedule|on track|progress|goal|5k|pr|improve/.test(text)) {
    const pace = c.weekSessions > 0 ? (c.weekMileageKm / c.weekSessions).toFixed(1) : "—";
    return `This week so far: ${fmtKm(c.weekMileageKm * 1000)}, ${c.weekSessions} sessions, ~${c.weekStrain.toFixed(1)} accumulated strain (avg ${pace} km/session). For a sub-20 5k the weekly staples are one threshold session, one long run, and easy miles in between — your recovery today says ${c.recoveryColor}, so slot the quality session accordingly.`;
  }

  if (/eat|diet|nutrition|protein|fuel|food|water/.test(text)) {
    return `Fuel for a ${c.recoveryColor} day at ${c.recovery}% recovery: keep protein around 1.6–2 g/kg spread across meals, carbs scaled to the session you actually run (${c.strain.toFixed(1)} / ${c.strainTarget.toFixed(1)} strain now), and 2.5–3 L of water. If you go red, cut carbs a touch but don't cut protein — recovery is a protein-hungry process.`;
  }

  return `Here's where you stand: recovery ${c.recovery}% (${c.recoveryColor}), strain ${c.strain.toFixed(1)} / ${c.strainTarget.toFixed(1)}, sleep score ${c.sleepScore}, habits ${c.habitsDone}/${c.habitsDue}. ${recommendWorkout(c)} Ask me about recovery, sleep, strain, habits, weekly progress, or nutrition.`;
}

/**
 * The exact prompt you'd send to an LLM (OpenAI / Anthropic) when wiring a
 * real model in — swap coachReply's rule engine for a model call with this as
 * the system prompt.
 */
export function buildSystemPrompt(c: CoachContext): string {
  return `You are rythm, a context-aware endurance coach for an athlete with goal "${c.goal}" (age ${c.age}).

TODAY'S CONTEXT (authoritative — ground every answer in these numbers):
- Recovery: ${c.recovery}/100 (${c.recoveryColor}). Strain now: ${c.strain.toFixed(1)} / target ${c.strainTarget.toFixed(1)}.
- HRV: ${c.hrv} ms (7-day baseline ${c.hrvBaseline.toFixed(0)} ms). Resting HR: ${c.rhr} bpm (baseline ${c.rhrBaseline.toFixed(0)}).
- Sleep: score ${c.sleepScore}, ${(c.sleepMin / 60).toFixed(1)} h vs ${(c.needMin / 60).toFixed(1)} h need (${c.sleepDebtMin} min debt).
- Habits: ${c.habitsDone}/${c.habitsDue} done today.
- This week: ${fmtKm(c.weekMileageKm * 1000)}, ${c.weekSessions} sessions, ${c.weekStrain.toFixed(1)} strain.
- Last 7 days: ${c.workouts7.map((w) => `${w.title} (${w.when}, ${w.durationMin} min, ${fmtKm(w.km * 1000)}, strain ${w.strain})`).join("; ") || "none"}.

Rules: be concise (2-4 sentences), specific, and evidence-based. Adapt intensity to recovery color: green = push, yellow = moderate, red = rest/recovery. Never invent numbers that contradict the context.`;
}

// ---------------------------------------------------------------------------
// LLM path (optional). Resolution order:
//   1. VITE_COACH_API        -> serverless function (api/coach.ts). Model key
//                               lives server-side — the production path.
//   2. VITE_GEMINI_API_KEY   -> direct browser call to Google Gemini. Google
//                               ships Gemini keys for client use; restrict by
//                               HTTP referrer in Cloud Console for prod.
//   3. Neither               -> deterministic engine (offline).
// Any failure — not configured, timeout, 4xx/5xx, empty reply — falls back to
// the deterministic engine above, so the coach always answers.
// ---------------------------------------------------------------------------

export interface CoachHistoryMsg {
  role: "user" | "assistant";
  text: string;
}

/** "ai" when a model path is configured, "engine" for the offline engine. */
export function coachMode(): "ai" | "engine" {
  const api = ((import.meta.env.VITE_COACH_API as string | undefined) ?? "").trim();
  const gemini = ((import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? "").trim();
  return api || gemini ? "ai" : "engine";
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Direct call to the Gemini REST API (dev path — key ships in the bundle). */
async function geminiReply(system: string, history: CoachHistoryMsg[]): Promise<string | null> {
  const key = ((import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? "").trim();
  if (!key) return null;
  const model = ((import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? "gemini-3.5-flash").trim();
  try {
    const contents = history.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.text }],
    }));
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: {
            maxOutputTokens: 600,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
      15000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const reply = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return reply || null;
  } catch {
    return null; // offline / timeout — engine takes over
  }
}

/**
 * Shared low-level LLM call used by the chat coach AND the AI analysis
 * sections across the score sheets. Resolution order:
 *   1. VITE_COACH_API        -> serverless function (api/coach.ts)
 *   2. VITE_GEMINI_API_KEY   -> direct browser call to Google Gemini
 *   3. Neither               -> null (caller falls back to a deterministic
 *                                engine / canned answer)
 * Any failure — not configured, timeout, 4xx/5xx, empty reply — returns null.
 */
export async function llmComplete(
  system: string,
  messages: CoachHistoryMsg[]
): Promise<string | null> {
  const api = ((import.meta.env.VITE_COACH_API as string | undefined) ?? "").trim();

  // Path 1: serverless function (production).
  if (api) {
    const token = (import.meta.env.VITE_COACH_API_TOKEN as string | undefined) ?? "";
    try {
      const res = await fetchWithTimeout(
        api,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ system, messages }),
        },
        15000
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { reply?: string };
      const reply = (data.reply ?? "").trim();
      return reply || null;
    } catch {
      return null; // offline / timeout / bad response — engine takes over
    }
  }

  // Path 2: direct Gemini call (dev path).
  return geminiReply(system, messages);
}

export async function coachReplyWithLLM(
  raw: string,
  c: CoachContext,
  history: CoachHistoryMsg[]
): Promise<string | null> {
  const system = buildSystemPrompt(c);
  const messages = [...history, { role: "user" as const, text: raw }];
  return llmComplete(system, messages);
}
