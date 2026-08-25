/** Deterministic PRNG (mulberry32) so the demo data is stable across reloads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rand {
  next: () => number;
  range: (min: number, max: number) => number;
  int: (min: number, max: number) => number;
  /** gaussian-ish value around center with spread */
  around: (center: number, spread: number) => number;
  chance: (p: number) => boolean;
}

export function makeRand(seed: number): Rand {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    around: (center, spread) => {
      // sum of two uniforms → triangular-ish distribution centered on `center`
      const u = next() + next() - 1;
      return center + u * spread;
    },
    chance: (p) => next() < p,
  };
}

export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoDaysAgo(n: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return todayIso(d);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

export function dateFromIso(iso: string): Date {
  return new Date(iso + "T12:00:00");
}

export function weekdayOf(iso: string): number {
  return dateFromIso(iso).getDay();
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
