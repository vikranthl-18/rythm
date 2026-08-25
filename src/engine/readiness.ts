// ---------------------------------------------------------------------------
// Readiness — "how ready am I to train right now?"
// Blends recovery (55%), sleep score (30%) and today's strain load (15%).
// ---------------------------------------------------------------------------

export interface ReadinessInput {
  recovery: number; // 0–100
  sleepScore: number; // 0–100
  strainNow: number; // 0–21 today so far
  strainTarget: number; // recovery-scaled target
}

export interface ReadinessPart {
  label: string;
  score: number; // contribution to the final score
  weight: number;
}

export interface Readiness {
  score: number; // 0–100
  status: "Ready" | "Moderate" | "Low";
  verdict: string;
  parts: ReadinessPart[];
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const { recovery, sleepScore, strainNow, strainTarget } = input;

  // Strain pressure: how much of today's target has already been used.
  const strainPressure = Math.min(100, (strainNow / Math.max(1, strainTarget)) * 100);
  const freshness = 100 - strainPressure * 0.6; // hitting target early = less fresh

  const parts: ReadinessPart[] = [
    { label: "Recovery", score: recovery, weight: 0.55 },
    { label: "Sleep", score: sleepScore, weight: 0.3 },
    { label: "Freshness", score: freshness, weight: 0.15 },
  ];

  const score = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0));
  const status: Readiness["status"] = score >= 70 ? "Ready" : score >= 40 ? "Moderate" : "Low";

  let verdict: string;
  if (status === "Ready") {
    verdict = `Green light. Recovery is ${recovery}% and sleep scored ${sleepScore}/100 — your body is primed for quality work today.`;
  } else if (status === "Moderate") {
    verdict = `Amber light. You can train, but keep today's session controlled — easy-to-moderate work at most.`;
  } else {
    verdict = `Red light. Recovery (${recovery}%) and sleep (${sleepScore}/100) are both down — a rest or very easy day is the highest-value session.`;
  }

  return { score, status, verdict, parts };
}
