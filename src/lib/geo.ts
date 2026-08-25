// ---------------------------------------------------------------------------
// Geo helpers: haversine distance, route simulation, elevation noise.
// ---------------------------------------------------------------------------

import type { RoutePoint } from "../types";

export const EARTH_RADIUS_M = 6371000;

export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function pathDistanceM(points: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1], points[i]);
  return d;
}

/** Total route distance for points with per-point times. */
export function routeDistanceM(points: RoutePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
  }
  return d;
}

/** Elapsed seconds at which the route reaches `targetM` meters (null if never). */
export function timeToReachDistance(points: RoutePoint[], targetM: number): number | null {
  if (points.length < 2) return null;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    if (acc + seg >= targetM) {
      const frac = (targetM - acc) / (seg || 1);
      return points[i - 1].t + (points[i].t - points[i - 1].t) * frac;
    }
    acc += seg;
  }
  return null;
}

/** Distance covered by `t` seconds, interpolated along the route. */
export function distanceAtTime(points: RoutePoint[], t: number): number {
  if (points.length < 2) return 0;
  if (t <= points[0].t) return 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    if (t <= points[i].t) {
      const frac = (t - points[i - 1].t) / Math.max(1e-6, points[i].t - points[i - 1].t);
      return acc + seg * Math.max(0, Math.min(1, frac));
    }
    acc += seg;
  }
  return acc;
}

/**
 * Deterministic pseudo-elevation in meters for a lat/lng: gentle long-wavelength
 * terrain plus faster rolling hills (~4 m amplitude) so recorded runs accrue a
 * believable elevation gain.
 */
export function fakeElevation(lat: number, lng: number): number {
  const x = lat * 110.574;
  const y = lng * 111.32 * Math.cos((lat * Math.PI) / 180);
  return (
    60 +
    18 * Math.sin(x * 0.013) * Math.cos(y * 0.011) +
    9 * Math.sin(x * 0.043 + 2.1) +
    6 * Math.cos(y * 0.037 + 0.7) +
    4 * Math.sin(x * 5.2 + 1.3) * Math.cos(y * 3.9)
  );
}

/** Formats meters-per-second into mm:ss per km pace. */
export function pacePerKm(ms: number): string {
  if (!ms || ms <= 0) return "--'--\"";
  const sPerKm = 1000 / ms;
  return fmtMmSs(sPerKm);
}

export function fmtMmSs(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}'${String(r).padStart(2, "0")}"`;
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtKm(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`;
  return `${Math.round(m)} m`;
}

export function fmtSpeedKmh(ms: number): string {
  if (ms <= 0) return "0.0";
  return (ms * 3.6).toFixed(1);
}
