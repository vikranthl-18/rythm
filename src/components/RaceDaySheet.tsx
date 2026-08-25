import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  buildRaceDayStrategy,
  fetchRaceDayWeather,
  geocodeCity,
  type RaceDayWeather,
} from "../engine/raceDay";
import { raceDistanceLabel } from "../engine/periodize";

const fmtPace = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export default function RaceDaySheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const race = s.profile.race;
  const today = s.days[s.days.length - 1];
  const [elevation, setElevation] = useState("0");
  const [city, setCity] = useState("");
  const [weather, setWeather] = useState<RaceDayWeather | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Their recent average run pace (fallback when no goal pace set).
  const fitnessPace = useMemo(() => {
    const runs = s.workouts
      .filter((w) => (w.type === "run" || w.type === "trail") && w.distanceM > 0)
      .slice(-10);
    if (!runs.length) return undefined;
    return runs.reduce((a, w) => a + w.durationSec / (w.distanceM / 1000), 0) / runs.length;
  }, [s.workouts]);

  const hasLocation = !!s.gpsPos;
  const locationLabel = hasLocation
    ? "your GPS location"
    : city.trim()
      ? city.trim()
      : "enter a city for weather";

  const fetchWeather = async () => {
    if (!race) return;
    setBusy(true);
    setErr(null);
    try {
      let lat: number;
      let lon: number;
      if (s.gpsPos) {
        [lat, lon] = s.gpsPos;
      } else {
        if (!city.trim()) return setErr("Enter a city (or enable GPS in Settings → Location & audio).");
        const geo = await geocodeCity(city.trim());
        if (!geo) return setErr("Couldn't find that city — try 'City, Country'.");
        [lat, lon] = [geo.lat, geo.lon];
      }
      const w = await fetchRaceDayWeather(lat, lon, race.dateIso);
      setWeather(w);
      if (w.tempC === null && w.source.includes("no forecast")) {
        setErr("No forecast is available that far out yet — check back closer to race day.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!race) return null;
  const strat = buildRaceDayStrategy({
    race,
    recovery: today.recovery,
    weather:
      weather ?? { tempC: null, precipPct: null, windKmh: null, source: "no weather yet" },
    elevationGainM: parseInt(elevation, 10) || 0,
    fitnessPaceSecPerKm: fitnessPace,
  });

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">🏁</div>
          <h2>Race-day strategy</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="hint" style={{ marginTop: 0 }}>
            <b>{raceDistanceLabel(race.distanceKm)}</b> on {race.dateIso} — goal pace{" "}
            <b>{fmtPace(race.targetPaceSecPerKm ?? fitnessPace ?? 360)}/km</b>
            {race.targetPaceSecPerKm ? "" : " (estimated from your recent runs)"}. Strategy
            adjusts for race-day weather, course climb and today&apos;s recovery.
          </p>

          <div className="field-row">
            <label className="field">
              <span>Course climb (m)</span>
              <input type="number" min={0} value={elevation} onChange={(e) => setElevation(e.target.value)} placeholder="0" />
            </label>
            {!hasLocation && (
              <label className="field">
                <span>City for weather</span>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Berlin, Germany" />
              </label>
            )}
          </div>

          <button className="btn-ghost" style={{ marginTop: 4 }} disabled={busy} onClick={() => void fetchWeather()}>
            {busy ? "Fetching…" : weather ? "↻ Refresh weather" : "🌤 Get race-day weather"}
          </button>
          {hasLocation && !weather && (
            <span className="hint-inline" style={{ marginLeft: 8 }}>using your GPS location</span>
          )}
          {err && <p className="hint" style={{ color: "var(--red)" }}>{err}</p>}

          {weather?.source && weather.source !== "unavailable" && weather.source !== "no weather yet" && (
            <p className="hint" style={{ marginTop: 6 }}>
              {locationLabel}: <b>{strat.conditions}</b>
            </p>
          )}

          <div className="race-bands" style={{ marginTop: 10 }}>
            {strat.bands.map((b) => (
              <div key={b.label} className={`race-band ${b.label === "Goal" ? "goal" : ""}`}>
                <span className="race-band-label">{b.label}</span>
                <span className="race-band-pace">{fmtPace(b.secPerKm)}<span className="race-band-unit">/km</span></span>
              </div>
            ))}
          </div>
          {weather?.source !== "no weather yet" && (
            <p className="hint" style={{ marginTop: 6 }}>
              Base {fmtPace(strat.basePaceSecPerKm)}/km → adjusted{" "}
              <b>{fmtPace(strat.adjustedPaceSecPerKm)}/km</b> (
              {Math.round(((strat.adjustedPaceSecPerKm - strat.basePaceSecPerKm) / strat.basePaceSecPerKm) * 100)}%).
            </p>
          )}

          {strat.tips.length > 0 && (
            <div className="race-tips" style={{ marginTop: 8 }}>
              {strat.tips.map((t) => (
                <p key={t} className="race-tip">· {t}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
