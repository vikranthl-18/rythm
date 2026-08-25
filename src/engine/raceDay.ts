// ---------------------------------------------------------------------------
// Race-day mode — the plan ends with a real strategy on the start line.
// Fetches race-day weather for the user's location (Open-Meteo, free + no
// key) and computes elevation-aware pace bands, then adjusts them by today's
// recovery so the goal is honest on the day.
// ---------------------------------------------------------------------------

import type { RaceConfig } from "../types";

export interface RaceDayWeather {
  tempC: number | null;
  precipPct: number | null;
  windKmh: number | null;
  source: string;
}

export interface PaceBand {
  label: string;
  secPerKm: number;
}

export interface RaceDayStrategy {
  basePaceSecPerKm: number;
  adjustedPaceSecPerKm: number;
  bands: PaceBand[]; // conservative → goal → aggressive
  weather: RaceDayWeather;
  elevationGainM: number;
  conditions: string; // one-line summary
  tips: string[];
}

/** Weather for a lat/lon + date via Open-Meteo (no API key needed). */
export async function fetchRaceDayWeather(
  lat: number,
  lon: number,
  dateIso: string
): Promise<RaceDayWeather> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=16`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as {
      daily?: {
        time: string[];
        temperature_2m_max: (number | null)[];
        precipitation_probability_max: (number | null)[];
        wind_speed_10m_max: (number | null)[];
      };
    };
    const daily = json.daily;
    if (!daily) return { tempC: null, precipPct: null, windKmh: null, source: "no forecast" };
    const idx = daily.time.findIndex((t) => t.slice(0, 10) === dateIso);
    if (idx < 0) {
      return { tempC: null, precipPct: null, windKmh: null, source: "no forecast for race day yet" };
    }
    return {
      tempC: daily.temperature_2m_max[idx] ?? null,
      precipPct: daily.precipitation_probability_max[idx] ?? null,
      windKmh: daily.wind_speed_10m_max[idx] ?? null,
      source: "Open-Meteo",
    };
  } catch {
    return { tempC: null, precipPct: null, windKmh: null, source: "unavailable" };
  }
}

/** Geocode a city name via Open-Meteo (free, no key). Returns null on error. */
export async function geocodeCity(city: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: { latitude: number; longitude: number; name: string; country?: string }[];
    };
    const r = json.results?.[0];
    if (!r) return null;
    return { lat: r.latitude, lon: r.longitude, label: `${r.name}${r.country ? `, ${r.country}` : ""}` };
  } catch {
    return null;
  }
}

export function buildRaceDayStrategy(input: {
  race: RaceConfig;
  recovery: number;
  weather: RaceDayWeather;
  elevationGainM: number;
  fitnessPaceSecPerKm?: number; // their recent average run pace
}): RaceDayStrategy {
  const { race, recovery, weather, elevationGainM } = input;
  const base = race.targetPaceSecPerKm ?? input.fitnessPaceSecPerKm ?? 360;

  // Adjustments (multiplicative, applied in order).
  let factor = 1;
  const tips: string[] = [];
  if (recovery < 34) {
    factor *= 1.08;
    tips.push("Recovery is red — this is a finish-it-and-enjoy-it day. Drop the goal pace and run by feel.");
  } else if (recovery < 67) {
    factor *= 1.03;
    tips.push("Recovery is yellow — give yourself 3% and bank the first 3 km slightly under goal.");
  } else {
    tips.push("Recovery is green — the plan's goal pace is realistic today.");
  }
  if (weather.tempC !== null && weather.tempC >= 30) {
    factor *= 1.1;
    tips.push(`${weather.tempC}°C is hot — slow down ~10%, take every water stop, pour water on your neck.`);
  } else if (weather.tempC !== null && weather.tempC >= 25) {
    factor *= 1.06;
    tips.push(`${weather.tempC}°C is warm — bank 6% early and hold it; heat punishes the second half.`);
  } else if (weather.tempC !== null && weather.tempC < 8) {
    tips.push(`${weather.tempC}°C — dress in layers you can shed; warm gloves and a hat go a long way.`);
  }
  if (weather.windKmh !== null && weather.windKmh >= 30) {
    factor *= 1.05;
    tips.push(`${weather.windKmh} km/h wind — run the exposed sections at effort, not pace; hide behind packs.`);
  } else if (weather.windKmh !== null && weather.windKmh >= 20) {
    factor *= 1.03;
    tips.push(`Windy (${weather.windKmh} km/h) — use the first 2 km to feel it out, then settle.`);
  }
  if (weather.precipPct !== null && weather.precipPct >= 50) {
    tips.push(`${weather.precipPct}% chance of rain — race in what you'd train in; bodyglide stops chafing.`);
  }
  if (elevationGainM > 0) {
    const perKm = elevationGainM / Math.max(1, race.distanceKm);
    const elevFactor = (perKm / 100) * 0.01; // +1% per 100m/km
    factor *= 1 + elevFactor;
    tips.push(
      `${elevationGainM} m of climb — treat climbs as effort, not pace; surge only the downhills you know.`
    );
  }

  const adjusted = Math.round(base * factor);
  return {
    basePaceSecPerKm: base,
    adjustedPaceSecPerKm: adjusted,
    bands: [
      { label: "Conservative", secPerKm: Math.round(adjusted * 1.06) },
      { label: "Goal", secPerKm: adjusted },
      { label: "Aggressive", secPerKm: Math.round(adjusted * 0.97) },
    ],
    weather,
    elevationGainM,
    conditions: [
      weather.tempC !== null ? `${Math.round(weather.tempC)}°C` : null,
      weather.precipPct !== null ? `${weather.precipPct}% rain` : null,
      weather.windKmh !== null ? `${Math.round(weather.windKmh)} km/h wind` : null,
      elevationGainM > 0 ? `${elevationGainM} m climb` : null,
      recovery < 34 ? "red recovery" : recovery < 67 ? "yellow recovery" : "green recovery",
    ]
      .filter(Boolean)
      .join(" · "),
    tips,
  };
}
