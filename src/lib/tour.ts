// ---------------------------------------------------------------------------
// First-run feature tour. Shown once per account (right after onboarding +
// the GPS consent sheet) so every new user learns rythm's signature features.
// Persisted per account so a demo account and a real account each get their
// own first-run experience, and so it never nags again after being finished.
// ---------------------------------------------------------------------------

const TOUR_PREFIX = "rythm-tour-";

export function tourKey(email: string): string {
  return TOUR_PREFIX + email.toLowerCase();
}

/** Whether this account has already finished (or skipped) the intro tour. */
export function loadTourSeen(email: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(tourKey(email)) === "1";
  } catch {
    return false;
  }
}

/** Mark the tour seen (finished or skipped) for this account. */
export function saveTourSeen(email: string, seen: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (seen) localStorage.setItem(tourKey(email), "1");
    else localStorage.removeItem(tourKey(email));
  } catch {
    /* storage unavailable — the tour will just show again next launch */
  }
}
