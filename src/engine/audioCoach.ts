// ---------------------------------------------------------------------------
// Audio coach — "a coach in your ear." A pure cue evaluator (testable) plus a
// thin browser TTS helper. Cues fire when HR drifts outside the session's
// target band, when pace drifts from goal pace, when you gain/lose time
// against a ghost, and at each kilometer split.
// ---------------------------------------------------------------------------

export interface AudioCueState {
  hr: number;
  hrMax: number;
  /** target HR band as fractions of HRmax (e.g. [0.72, 0.84] for a tempo run) */
  targetZone: [number, number];
  /** current pace in m/s (null indoors) */
  paceMs: number | null;
  /** goal pace in m/s (from a race plan or ghost) */
  targetPaceMs: number | null;
  elapsedSec: number;
  /** +seconds ahead / -seconds behind a ghost, if racing one */
  ghostDeltaSec: number | null;
  ghostName: string | null;
  /** current kilometer mark (0 = not reached 1 km yet) */
  km: number;
  /** the last kilometer that was announced */
  lastKmAnnounced: number;
  /** the last cue spoken (to avoid repeating) */
  lastCue: string | null;
  /** sim/elapsed seconds when the last cue was spoken */
  lastCueAtSec: number;
}

export interface Cue {
  text: string;
  /** minimum seconds before the next cue may fire */
  cooldownSec: number;
}

const fmtPace = (secPerKm: number) => {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Evaluate one tick of live data. Returns a cue to speak, or null.
 * Pure — the store/UI owns the timing and the TTS call.
 */
export function evaluateCue(st: AudioCueState): Cue | null {
  const sinceLast = st.elapsedSec - st.lastCueAtSec;
  if (st.lastCue && sinceLast < 20) return null; // never talk over yourself

  const [zLo, zHi] = st.targetZone;
  const lo = st.hrMax * zLo;
  const hi = st.hrMax * zHi;

  // ---- heart rate band ----------------------------------------------------
  if (st.hr > hi + 3) {
    return {
      text: `You're ${Math.round(st.hr - hi)} beats over target. Ease off, back into zone.`,
      cooldownSec: 25,
    };
  }
  if (st.hr < lo - 3 && st.elapsedSec > 120) {
    return {
      text: `Pick it up — you're ${Math.round(lo - st.hr)} beats under target.`,
      cooldownSec: 30,
    };
  }

  // ---- ghost gap (only when racing someone) --------------------------------
  if (st.ghostDeltaSec !== null && st.ghostName && st.ghostDeltaSec !== 0) {
    const ahead = st.ghostDeltaSec > 0;
    const abs = Math.abs(st.ghostDeltaSec);
    if (abs >= 10) {
      return {
        text: ahead
          ? `You're ${Math.round(abs)} seconds ahead of ${st.ghostName}. Hold it.`
          : `You're ${Math.round(abs)} seconds behind ${st.ghostName}. Push.`,
        cooldownSec: 30,
      };
    }
  }

  // ---- pace vs goal pace ---------------------------------------------------
  if (st.paceMs && st.paceMs > 1.5 && st.targetPaceMs && st.targetPaceMs > 1.5) {
    const diffSecKm = Math.round(1000 / st.paceMs - 1000 / st.targetPaceMs);
    if (Math.abs(diffSecKm) >= 8) {
      return {
        text:
          diffSecKm > 0
            ? `You're ${diffSecKm} seconds per K slower than goal pace.`
            : `Nice — you're ${Math.abs(diffSecKm)} seconds per K faster than goal pace.`,
        cooldownSec: 30,
      };
    }
  }

  // ---- kilometer splits -----------------------------------------------------
  if (st.km >= 1 && Math.floor(st.km) > st.lastKmAnnounced && st.paceMs && st.paceMs > 1.5) {
    const kmN = Math.floor(st.km);
    if (sinceLast >= 45) {
      return {
        text: `Kilometer ${kmN} — ${fmtPace(1000 / st.paceMs)} per kilometer.`,
        cooldownSec: 30,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Browser TTS (guarded — no-ops in non-browser/test environments)
// ---------------------------------------------------------------------------

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let lastQueuedAt = 0;

export function speak(text: string): void {
  if (!speechAvailable()) return;
  const synth = window.speechSynthesis;
  // Debounce identical spam and cap the queue so cues stay current.
  const now = Date.now();
  if (now - lastQueuedAt < 800) return;
  lastQueuedAt = now;
  while (synth.speaking && synth.pending) {
    /* don't stack more than one */
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  const voices = synth.getVoices();
  const en = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (en) u.voice = en;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.cancel();
}
