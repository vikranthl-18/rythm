import { useMemo, useState } from "react";
import { useStore } from "../store";
import RaceDaySheet from "./RaceDaySheet";
import { computeLoadBalance } from "../engine/load";
import {
  RACE_DISTANCES,
  buildRacePlan,
  phaseNow,
  planSessionForDate,
  raceDistanceLabel,
  recoveryAdjustedSession,
  type PlanWeek,
} from "../engine/periodize";
import type { RaceConfig } from "../types";

const fmtCountdown = (days: number) =>
  days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`;

const fmtPace = (secPerKm: number) =>
  `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;

function SetupForm({ onBuilt }: { onBuilt: () => void }) {
  const s = useStore();
  const [km, setKm] = useState(21.0975);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 84); // 12 weeks out
    return d.toISOString().slice(0, 10);
  });
  const [paceMin, setPaceMin] = useState("");
  const [paceSec, setPaceSec] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const build = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (!date || date <= today) return setErr("Pick a race day in the future.");
    const race: RaceConfig = { distanceKm: km, dateIso: date };
    const pm = parseInt(paceMin, 10);
    const ps = parseInt(paceSec, 10);
    if (!Number.isNaN(pm) && pm >= 2 && pm <= 20) {
      race.targetPaceSecPerKm = pm * 60 + (Number.isNaN(ps) ? 0 : ps);
    }
    s.updateProfile({ race });
    onBuilt();
  };

  return (
    <div className="race-setup">
      <p className="hint" style={{ marginTop: 0 }}>
        Pick a race and rythm builds the plan backward: base → build → peak → taper,
        with weekly strain targets and key sessions. It adapts to your recovery every day.
      </p>
      <div className="field">
        <span>Distance</span>
        <div className="seg">
          {RACE_DISTANCES.map((r) => (
            <button
              key={r.km}
              className={`seg-btn ${Math.abs(km - r.km) < 0.01 ? "active" : ""}`}
              onClick={() => setKm(r.km)}
            >
              {r.icon} {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Race day</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field">
          <span>Goal pace (optional)</span>
          <div className="pace-row">
            <input
              type="number"
              min={2}
              max={20}
              placeholder="min"
              value={paceMin}
              onChange={(e) => setPaceMin(e.target.value)}
              className="mini-input"
            />
            <span className="hint-inline">:</span>
            <input
              type="number"
              min={0}
              max={59}
              placeholder="sec"
              value={paceSec}
              onChange={(e) => setPaceSec(e.target.value)}
              className="mini-input"
            />
            <span className="hint-inline">/km</span>
          </div>
        </div>
      </div>
      {err && <p className="auth-error">{err}</p>}
      <button className="btn-start" onClick={build}>
        🏁 Build my race plan
      </button>
    </div>
  );
}

function WeekRow({ week, todayIso }: { week: PlanWeek; todayIso: string }) {
  const [open, setOpen] = useState(false);
  const current = todayIso >= week.startIso && todayIso < addDaysStr(week.startIso, 7);
  return (
    <div className={`plan-week ${current ? "current" : ""}`}>
      <button className="plan-week-head" onClick={() => setOpen((o) => !o)}>
        <span className="plan-week-label">
          {week.phaseLabel}
          {week.longRunKm !== null && week.phase !== "race" && (
            <span className="plan-week-long">long {week.longRunKm.toFixed(1)} km</span>
          )}
        </span>
        <span className="plan-week-meta">
          {week.startIso.slice(5)} · {week.strainTarget} strain
          <span className="wo-chev">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div className="plan-week-body">
          {week.sessions.map((sess, i) => (
            <div key={i} className="plan-session">
              <span className="plan-session-day">{sess.dayLabel}</span>
              <span className="plan-session-title">{sess.title}</span>
              <span className="plan-session-desc">{sess.desc}</span>
              <span className="plan-session-strain">{sess.strain}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function addDaysStr(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function RacePlanSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const race = s.profile.race;
  const todayIso = s.days[s.days.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const [editing, setEditing] = useState(!race);
  const [removing, setRemoving] = useState(false);
  const [raceDayOpen, setRaceDayOpen] = useState(false);

  const plan = useMemo(() => {
    if (!race) return null;
    const longest = Math.max(
      0,
      ...s.workouts
        .filter((w) => w.type === "run" || w.type === "trail")
        .map((w) => w.distanceM / 1000)
    );
    return buildRacePlan({ race, todayIso, currentLongRunKm: longest || undefined });
  }, [race, s.workouts, todayIso]);

  const todayRecovery = s.days[s.days.length - 1]?.recovery ?? 70;
  const load = useMemo(() => computeLoadBalance(s.days), [s.days]);
  const phase = plan ? phaseNow(plan, todayIso) : null;
  const planned = plan ? planSessionForDate(plan, todayIso) : null;
  const adjusted = plan
    ? recoveryAdjustedSession(planned, todayRecovery)
    : null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">🏁</div>
          <h2>Race plan</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {!plan || editing ? (
            <>
              <SetupForm onBuilt={() => setEditing(false)} />
              {race && (
                <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setEditing(false)}>
                  ← Back to plan
                </button>
              )}
            </>
          ) : (
            <>
              <div className="race-hero">
                <div className="race-hero-main">
                  <span className="race-hero-dist">{raceDistanceLabel(plan.race.distanceKm)}</span>
                  <span className="race-hero-date">
                    {new Date(plan.race.dateIso + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · in {fmtCountdown(plan.countdownDays)}
                  </span>
                  {plan.race.targetPaceSecPerKm && (
                    <span className="race-hero-pace">
                      goal pace {fmtPace(plan.race.targetPaceSecPerKm)}/km
                    </span>
                  )}
                </div>
                <div className={`phase-chip phase-${phase?.phase}`}>{phase?.label}</div>
              </div>

              {adjusted && (
                <div className="today-session">
                  <span className="today-session-label">Today · {adjusted.title}</span>
                  <span className="today-session-desc">{adjusted.desc}</span>
                  {adjusted.swapped && (
                    <span className="hint-inline">
                      {todayRecovery < 34
                        ? "Recovery red — the plan bent for you."
                        : "Recovery yellow — intensity dropped, plan kept."}
                    </span>
                  )}
                </div>
              )}

              <p className="hint" style={{ marginTop: 8 }}>
                Load ratio {load.acwr.toFixed(2)}× ({load.status.toLowerCase()}) · strain targets
                are weekly totals. Tap a week to see its sessions.
              </p>

              <div className="plan-list">
                {plan.weeks.map((w) => (
                  <WeekRow key={w.startIso} week={w} todayIso={todayIso} />
                ))}
              </div>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn-start" style={{ flex: 1 }} onClick={() => setRaceDayOpen(true)}>
                  🏁 Race-day strategy
                </button>
                <button className="btn-ghost" onClick={() => setEditing(true)}>
                  Change race
                </button>
                <button
                  className={`btn-ghost btn-danger ${removing ? "confirm" : ""}`}
                  onClick={() => {
                    if (removing) {
                      s.updateProfile({ race: undefined });
                      onClose();
                    } else {
                      setRemoving(true);
                      setTimeout(() => setRemoving(false), 4000);
                    }
                  }}
                >
                  {removing ? "Tap again to remove the plan" : "Remove plan"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {raceDayOpen && (
        <RaceDaySheet onClose={() => setRaceDayOpen(false)} />
      )}
    </div>
  );
}
