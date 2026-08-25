// ---------------------------------------------------------------------------
// AI-derived performance metrics (Module: context-aware estimates)
//
// These are transparent, formula-based estimates computed from the user's
// profile (age, sex, weight, height) and their actual biometrics (resting HR,
// HRV, recovery & strain history). Every number is explainable — the UI shows
// the formula and the inputs that went into it.
// ---------------------------------------------------------------------------

export interface AiInput {
  age: number;
  sex: "male" | "female";
  weightKg: number;
  heightCm: number;
  restingHR: number; // today's resting heart rate (bpm)
  hrv: number; // today's HRV (ms)
  days: { recovery: number; strain: number }[]; // recent history (oldest → newest)
}

export interface AiMetrics {
  maxHr: number; // 220 − age (matches the HR-zone engine)
  vo2max: number; // mL/kg/min (Uth–Sørensen–Overgaard estimate)
  vo2Expected: number; // age/sex norm
  vo2Label: string; // Excellent / Very good / Good / Fair / Poor
  vo2Pct: number; // rough percentile vs norms (0–100)
  hrvNorm: number; // expected HRV for age
  rhrNorm: number; // expected resting HR for age
  fitnessScore: number; // 0–100 composite
  fitnessLabel: string;
  biologicalAge: number;
  cardioAge: number;
  trainingStatus: "Detraining" | "Maintaining" | "Productive" | "Overreaching" | "Peaking";
  rmrKcal: number; // resting metabolic rate (Mifflin-St Jeor)
  weeklyLoad: number; // avg daily strain, last 7 days
  recoveryTrend: number; // avg recovery, last 3 days
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Expected HRV (RMSSD, ms) roughly declines with age. */
export function expectedHrv(age: number): number {
  return 76 - 0.5 * age;
}

/** Expected resting HR (bpm) rises slightly with age. */
export function expectedRhr(age: number): number {
  return 55 + 0.2 * age;
}

/** Age/sex VO2max norm (mL/kg/min), linear approximation of ACSM tables. */
export function expectedVo2(age: number, sex: "male" | "female"): number {
  return (sex === "male" ? 56 : 50.5) - 0.35 * age;
}

export function vo2Label(vo2: number, expected: number): string {
  const diff = vo2 - expected;
  if (diff >= 12) return "Excellent";
  if (diff >= 3) return "Very good";
  if (diff >= -2) return "Good";
  if (diff >= -8) return "Fair";
  return "Poor";
}

export function fitnessLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Very good";
  if (score >= 50) return "Good";
  if (score >= 35) return "Fair";
  return "Poor";
}

export function computeAiMetrics(input: AiInput): AiMetrics {
  const { age, sex, weightKg, heightCm, restingHR, hrv, days } = input;

  const maxHr = 220 - age;
  // Uth–Sørensen–Overgaard: VO2max ≈ 15.3 × (HRmax ÷ resting HR)
  const vo2max = (15.3 * maxHr) / Math.max(40, restingHR);
  const vo2Exp = expectedVo2(age, sex);
  const vDiff = vo2max - vo2Exp;
  const vo2Pct = clamp(Math.round(50 + vDiff * 5), 2, 98);

  const hrvNorm = expectedHrv(age);
  const rhrNorm = expectedRhr(age);
  const hrvScore = clamp(50 + (hrv - hrvNorm) * 2.2, 0, 100);
  const rhrScore = clamp(50 + (rhrNorm - restingHR) * 2.0, 0, 100);

  const fitnessScore = Math.round(0.35 * hrvScore + 0.25 * rhrScore + 0.4 * vo2Pct);

  const biologicalAge = clamp(age - (fitnessScore - 50) * 0.22, age - 12, age + 10);
  const cardioAge = clamp(age - ((vo2Pct - 50) / 100) * 14, age - 12, age + 10);

  // Training status: Whoop-style blend of recent recovery and load.
  const week = days.slice(-7);
  const weeklyLoad = week.length
    ? week.reduce((a, d) => a + d.strain, 0) / week.length
    : 0;
  const rec3 = days.slice(-3);
  const recoveryTrend = rec3.length
    ? rec3.reduce((a, d) => a + d.recovery, 0) / rec3.length
    : 50;

  let trainingStatus: AiMetrics["trainingStatus"];
  if (weeklyLoad < 3) trainingStatus = "Detraining";
  else if (recoveryTrend >= 70) trainingStatus = "Peaking";
  else if (recoveryTrend >= 60) trainingStatus = "Productive";
  else if (recoveryTrend >= 40) trainingStatus = "Maintaining";
  else trainingStatus = "Overreaching";

  // Mifflin-St Jeor resting metabolic rate.
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const rmrKcal = Math.round(sex === "male" ? base + 5 : base - 161);

  return {
    maxHr,
    vo2max: Math.round(vo2max * 10) / 10,
    vo2Expected: Math.round(vo2Exp * 10) / 10,
    vo2Label: vo2Label(vo2max, vo2Exp),
    vo2Pct,
    hrvNorm: Math.round(hrvNorm * 10) / 10,
    rhrNorm: Math.round(rhrNorm * 10) / 10,
    fitnessScore,
    fitnessLabel: fitnessLabel(fitnessScore),
    biologicalAge: Math.round(biologicalAge * 10) / 10,
    cardioAge: Math.round(cardioAge * 10) / 10,
    trainingStatus,
    rmrKcal,
    weeklyLoad: Math.round(weeklyLoad * 10) / 10,
    recoveryTrend: Math.round(recoveryTrend),
  };
}

export type MetricTone = "good" | "warn" | "bad" | "accent";

export interface MetricExplainer {
  label: string;
  value: string;
  unit?: string;
  badge?: string; // short status shown as a pill (e.g. "Very good", "younger")
  tone: MetricTone;
  body: string; // what it means + how it was computed
}

const toneForLabel = (l: string): MetricTone =>
  l === "Excellent" || l === "Very good" ? "good" : l === "Good" ? "accent" : l === "Fair" ? "warn" : "bad";

/** Human-readable explainers shown in the AI metrics sheet. */
export function aiMetricExplainers(ai: AiMetrics, input: AiInput): MetricExplainer[] {
  const { age, sex, restingHR, hrv } = input;
  const ageDelta = Math.round((ai.biologicalAge - age) * 10) / 10;

  return [
    {
      label: "VO₂max",
      value: ai.vo2max.toFixed(1),
      unit: "mL/kg/min",
      badge: ai.vo2Label,
      tone: toneForLabel(ai.vo2Label),
      body: `Estimated aerobic capacity — the max oxygen your muscles can use per kg per minute. We use the Uth–Sørensen–Overgaard formula: 15.3 × (HRmax ÷ resting HR) = 15.3 × (${ai.maxHr} ÷ ${restingHR}) ≈ ${ai.vo2max.toFixed(1)}. That places you in the top ~${100 - ai.vo2Pct}% of ${sex === "male" ? "men" : "women"} your age (expected ≈ ${ai.vo2Expected}).`,
    },
    {
      label: "Fitness score",
      value: String(ai.fitnessScore),
      unit: "/100",
      badge: ai.fitnessLabel,
      tone: toneForLabel(ai.fitnessLabel),
      body: `A 0–100 composite of three signals vs your age norms: HRV (${hrv} ms vs ${ai.hrvNorm} expected, 35%), resting HR (${restingHR} bpm vs ${ai.rhrNorm} expected, 25%) and VO₂max percentile (${ai.vo2Pct}, 40%). You're currently ${ai.fitnessLabel.toLowerCase()} (${ai.fitnessScore}).`,
    },
    {
      label: "Biological age",
      value: ai.biologicalAge.toFixed(1),
      unit: "yrs",
      badge: ageDelta <= 0 ? "younger" : "older",
      tone: ai.biologicalAge <= age ? "good" : "warn",
      body: `How old your body behaves like, given your fitness signals. We shift your chronological age (${age}) by −0.22 yrs per fitness-score point above 50: ${age} − (${ai.fitnessScore} − 50) × 0.22 ≈ ${ai.biologicalAge.toFixed(1)}. You're ${ageDelta >= 0 ? `${ageDelta} yrs older than` : `${-ageDelta} yrs younger than`} your calendar age.`,
    },
    {
      label: "Cardio age",
      value: ai.cardioAge.toFixed(1),
      unit: "yrs",
      badge: ai.cardioAge <= age ? "younger" : "older",
      tone: ai.cardioAge <= age ? "good" : "warn",
      body: `Heart-focused age estimate driven by VO₂max alone: ${age} − (VO₂max percentile − 50) × 0.14 ≈ ${ai.cardioAge.toFixed(1)}. A lower cardio age than biological age suggests your engine (aerobic base) is ahead of your overall recovery/fitness.`,
    },
    {
      label: "Training status",
      value: ai.trainingStatus,
      badge: ai.trainingStatus,
      tone: ai.trainingStatus === "Overreaching" ? "bad" : ai.trainingStatus === "Peaking" || ai.trainingStatus === "Productive" ? "good" : "accent",
      body: `Readiness trend over the last 3 days (${ai.recoveryTrend}% avg recovery) vs your load (${ai.weeklyLoad.toFixed(1)} avg daily strain). ${statusExplain(ai.trainingStatus)}`,
    },
    {
      label: "Resting metabolic rate",
      value: ai.rmrKcal.toLocaleString(),
      unit: "kcal/day",
      badge: "at rest",
      tone: "accent",
      body: `Calories your body burns at complete rest, via Mifflin-St Jeor: 10 × weight (${input.weightKg} kg) + 6.25 × height (${input.heightCm} cm) − 5 × age (${age}) ${sex === "male" ? "+ 5" : "− 161"} ≈ ${ai.rmrKcal}. Total daily burn is higher — this is just the baseline.`,
    },
    {
      label: "Max heart rate",
      value: String(ai.maxHr),
      unit: "bpm",
      badge: "220 − age",
      tone: "accent",
      body: `Estimate used for HR zones across the app: 220 − age = 220 − ${age} = ${ai.maxHr}. The most accurate version comes from a real max-effort test; we update zones automatically if you set a custom max HR.`,
    },
  ];
}

function statusExplain(status: AiMetrics["trainingStatus"]): string {
  switch (status) {
    case "Peaking":
      return "Recovery is high while load is meaningful — the classic window for race-day performance.";
    case "Productive":
      return "You're recovering well and absorbing training — a good window for quality work.";
    case "Maintaining":
      return "Recovery is middling; hold volume steady and avoid big jumps.";
    case "Overreaching":
      return "Recovery is low under sustained load — consider a down week before it becomes overtraining.";
    case "Detraining":
      return "Load has been very low, so fitness may be slipping — a light, consistent routine rebuilds it.";
  }
}
