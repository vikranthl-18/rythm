// ---------------------------------------------------------------------------
// HR zones & strain engine (Module 2: Day Strain Score 0.0–21.0)
// ---------------------------------------------------------------------------

export function hrMax(age: number): number {
  return 220 - age;
}

/** Zone boundaries as fractions of HRmax: [lo, hi). */
export const ZONE_PCT: [number, number][] = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

/**
 * Zone weight per minute spent in the zone. Z1 is deliberately near-weightless
 * so a sedentary day earns very little strain; hard zones dominate. These
 * weights are shared by both the live day accumulator and per-workout strain,
 * so a workout card and the day total stay on the same scale.
 */
export const ZONE_WEIGHTS = [0.01, 0.1, 1, 3, 4.5];

export const ZONE_COLORS = ["#3b82f6", "#73976a", "#eab308", "#fb923c", "#ef4444"];
export const ZONE_LABELS = ["Z1", "Z2", "Z3", "Z4", "Z5"];

export type Zone = 1 | 2 | 3 | 4 | 5;

export function zoneFor(hr: number, max: number): Zone {
  const p = hr / max;
  for (let i = 0; i < 5; i++) {
    if (p < ZONE_PCT[i][1]) return (i + 1) as Zone;
  }
  return 5;
}

export function zonePctRange(zone: Zone): [number, number] {
  return ZONE_PCT[zone - 1];
}

// ---------------------------------------------------------------------------
// Strain accumulation
//
// Strain follows a saturating (logarithmic-like) curve over accumulated
// zone-weighted minutes: early minutes earn strain quickly, later minutes get
// harder — mirroring Whoop's "strain is harder to earn at the top" behavior.
//
//   strain(W) = 21 · (1 − e^(−W / K))
//
// where W = Σ (zoneWeight · minutes) and K tunes how quickly it saturates.
// ---------------------------------------------------------------------------

export const STRAIN_MAX = 21;
// K tuned so a hard 45-min session reads ~14–16, a rest day ~4–6, and an
// active day with a workout ~15–19 (Whoop-like scale).
export const STRAIN_CURVE_K = 42;

export interface StrainState {
  strain: number;
  weightedMinutes: number;
}

export function strainFromWeighted(weightedMinutes: number): number {
  const s = STRAIN_MAX * (1 - Math.exp(-Math.max(0, weightedMinutes) / STRAIN_CURVE_K));
  return Math.min(STRAIN_MAX, Math.max(0, s));
}

export function accrueStrain(
  state: StrainState,
  hr: number,
  max: number,
  dtMin: number
): StrainState {
  const zone = zoneFor(hr, max);
  const w = ZONE_WEIGHTS[zone - 1] * dtMin;
  const weightedMinutes = state.weightedMinutes + w;
  return { weightedMinutes, strain: strainFromWeighted(weightedMinutes) };
}

export function weightedMinutesForZoneMinutes(z1: number, z2: number, z3: number, z4: number, z5: number): number {
  return z1 * ZONE_WEIGHTS[0] + z2 * ZONE_WEIGHTS[1] + z3 * ZONE_WEIGHTS[2] + z4 * ZONE_WEIGHTS[3] + z5 * ZONE_WEIGHTS[4];
}

/** Strain contributed by a single workout from its HR-zone distribution. */
export function workoutStrainFromZones(z1: number, z2: number, z3: number, z4: number, z5: number): number {
  return strainFromWeighted(weightedMinutesForZoneMinutes(z1, z2, z3, z4, z5));
}

/**
 * Target strain for the day given today's recovery, matching Whoop's
 * guidance: green days are for pushing, yellow for maintenance, red for rest.
 */
export function strainTarget(recovery: number): number {
  if (recovery >= 67) return 14.5;
  if (recovery >= 34) return 9.5;
  return 4;
}
