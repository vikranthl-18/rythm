// ---------------------------------------------------------------------------
// User-toggleable features. Everything here is ON by default — the Settings
// screen lets each user decide whether a feature runs. Flags are persisted
// per-browser under rythm-features and only ever flip behavior locally.
// ---------------------------------------------------------------------------

export interface FeatureFlags {
  /** LLM calls (AI coach chat, analysis blocks, AI-written digest). Off = fully on-device, nothing leaves the browser. */
  aiCoach: boolean;
  /** Weekly digest card on the home page. */
  weeklyDigest: boolean;
  /** "Beat last week" gamification card on the home page. */
  beatLastWeek: boolean;
  /** Habits linked to biometrics (e.g. "Sleep 8h") check themselves off from wearable data. */
  autoHabits: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = {
  aiCoach: true,
  weeklyDigest: true,
  beatLastWeek: true,
  autoHabits: true,
};

const KEY = "rythm-features";

export function loadFeatures(): FeatureFlags {
  if (typeof localStorage === "undefined") return { ...DEFAULT_FEATURES };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_FEATURES };
    const p = JSON.parse(raw) as Partial<FeatureFlags>;
    // Unknown/old entries fall back to the default (on) so a released toggle
    // never silently disables itself on upgrade.
    return {
      aiCoach: p.aiCoach !== false,
      weeklyDigest: p.weeklyDigest !== false,
      beatLastWeek: p.beatLastWeek !== false,
      autoHabits: p.autoHabits !== false,
    };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

export function saveFeatures(f: FeatureFlags): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* storage unavailable — the toggle just won't persist */
  }
}
