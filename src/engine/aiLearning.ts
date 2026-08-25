// ---------------------------------------------------------------------------
// AI metrics learning window — the app doesn't hand out VO₂max / biological
// age / fitness scores on day one. It watches the user's own HRV, resting HR,
// sleep and recovery for a full baseline window, then starts estimating.
// ---------------------------------------------------------------------------

/** Full days of data needed before AI-derived metrics unlock. */
export const AI_LEARNING_DAYS = 7;

export interface LearningStatus {
  learned: boolean;
  /** days of data collected so far, capped at AI_LEARNING_DAYS */
  elapsed: number;
  /** full days remaining in the learning window (0 when learned) */
  daysLeft: number;
}

export function learningStatus(
  profileCreatedAt?: string,
  now: Date = new Date()
): LearningStatus {
  // Accounts that predate the learning feature (or have no recorded start)
  // are treated as already learned so nothing locks up retroactively.
  if (!profileCreatedAt) {
    return { learned: true, elapsed: AI_LEARNING_DAYS, daysLeft: 0 };
  }
  const start = new Date(profileCreatedAt);
  if (Number.isNaN(start.getTime())) {
    return { learned: true, elapsed: AI_LEARNING_DAYS, daysLeft: 0 };
  }
  const elapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
  const learned = elapsed >= AI_LEARNING_DAYS;
  return {
    learned,
    elapsed: Math.min(elapsed, AI_LEARNING_DAYS),
    daysLeft: Math.max(0, AI_LEARNING_DAYS - elapsed),
  };
}
