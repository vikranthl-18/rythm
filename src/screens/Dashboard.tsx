import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import type { Tab } from "../App";
import type { MetricKey } from "../types";
import { activityDef } from "../types";
import { addDaysIso } from "../lib/rng";
import { baselineAndSd, recoveryColor } from "../engine/recovery";
import { hrMax, strainTarget, zoneFor } from "../engine/zones";
import { buildCoachContext, morningBrief } from "../engine/coach";
import { fmtDuration, fmtKm } from "../lib/geo";
import MetricDetail from "../components/MetricDetail";
import AiMetricsSheet from "../components/AiMetricsSheet";
import RythmScoreSheet from "../components/RythmScoreSheet";
import LoadBalanceSheet from "../components/LoadBalanceSheet";
import ReadinessSheet from "../components/ReadinessSheet";
import GoalProgressSheet from "../components/GoalProgressSheet";
import StrainDetailSheet from "../components/StrainDetailSheet";
import { aiMetricExplainers, computeAiMetrics } from "../engine/aiMetrics";
import { APP_VERSION } from "../lib/version";
import { AI_LEARNING_DAYS, learningStatus } from "../engine/aiLearning";
import { computeReadiness } from "../engine/readiness";
import { computeLoadBalance, recommendSession } from "../engine/load";
import { computeRythmScore } from "../engine/rhythm";
import { computeGoalProgress, matchGoal } from "../engine/goals";
import { habitDueOn } from "../engine/habits";
import { weeklyComparison } from "../engine/weekly";
import { phaseNow, planSessionForDate, raceDistanceLabel, recoveryAdjustedSession } from "../engine/periodize";
import { buildRacePlan } from "../engine/periodize";
import type { DigestInput } from "../engine/digest";
import DigestSheet from "../components/DigestSheet";
import RythmReportSheet from "../components/RythmReportSheet";
import ChallengesSheet from "../components/ChallengesSheet";
import RacePlanSheet from "../components/RacePlanSheet";
import { userBaselineBefore } from "../engine/baselines";
import { Bars, Delta, Pill, Section, Sparkline, StrainGauge } from "../components/ui";

const COLOR_HEX: Record<"green" | "yellow" | "red", string> = {
  green: "#73976a",
  yellow: "#c98a2d",
  red: "#a63c3c",
};

/** 12-hour clock for a minutes-since-midnight value (e.g. "6:31pm"). */
function fmtClock12(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** Real wall-clock time in the user's own timezone, 12-hour format. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="chip" title={now.toLocaleString()}>
      {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}
    </span>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const s = useStore();
  const today = s.days[s.days.length - 1];
  const [detail, setDetail] = useState<MetricKey | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [rythmOpen, setRythmOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [strainOpen, setStrainOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [raceOpen, setRaceOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [challengesOpen, setChallengesOpen] = useState(false);
  // Dismissible "test build" banner — an honest heads-up that data is local.
  const [bannerGone, setBannerGone] = useState(() => {
    try {
      return localStorage.getItem("rythm-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const dismissBanner = () => {
    setBannerGone(true);
    try {
      localStorage.setItem("rythm-banner-dismissed", "1");
    } catch {
      /* ignore */
    }
  };
  const ctx = useMemo(
    () =>
      buildCoachContext({
        goal: s.profile.goal,
        age: s.profile.age,
        today,
        strainNow: s.strain,
        habits: s.habits,
        days: s.days,
        workouts: s.workouts,
        todayIso: s.days[s.days.length - 1]?.date ?? "",
      }),
    [s.days, s.workouts, s.habits, s.profile, s.strain, today]
  );
  const color = recoveryColor(today.recovery);
  const hex = COLOR_HEX[color];
  const target = strainTarget(today.recovery);

  // habit stats for the Rythm Score
  const dueHabits = s.habits.filter((h) => habitDueOn(h, today.date));
  const doneHabits = dueHabits.filter((h) => h.logs[today.date] !== undefined);
  let weekDue = 0;
  let weekDone = 0;
  for (const h of s.habits) {
    for (let i = 0; i < 7; i++) {
      const iso = addDaysIso(today.date, -i);
      if (habitDueOn(h, iso)) {
        weekDue++;
        if (h.logs[iso] !== undefined) weekDone++;
      }
    }
  }
  const habitWeekPct = weekDue ? Math.round((weekDone / weekDue) * 100) : 100;
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const sessionDates = new Set(
    s.workouts.filter((w) => new Date(w.startIso) >= twoWeeksAgo).map((w) => w.startIso.slice(0, 10))
  );
  const sessionsDays = sessionDates.size;

  const load = useMemo(() => computeLoadBalance(s.days), [s.days]);
  const readiness = useMemo(
    () =>
      computeReadiness({
        recovery: today.recovery,
        sleepScore: today.sleep.score,
        strainNow: s.strain,
        strainTarget: target,
      }),
    [today, s.strain, target]
  );
  const rythm = useMemo(
    () =>
      computeRythmScore({
        recovery: today.recovery,
        sleepScore: today.sleep.score,
        strainNow: s.strain,
        strainTarget: target,
        acwr: load.acwr,
        loadStatus: load.status,
        steps: s.stepsToday,
        stepsGoal: 8000,
        zoneMinutes: today.activeZoneMin,
        zoneMinGoal: 150,
        habitToday: doneHabits.length,
        habitDue: dueHabits.length,
        habitWeekPct,
        sessionsDays,
      }),
    [today, s.strain, target, load, s.stepsToday, doneHabits.length, dueHabits.length, habitWeekPct, sessionsDays]
  );
  const matchedGoal = matchGoal(s.profile.goal);
  const goalProgress = useMemo(
    () =>
      matchedGoal
        ? computeGoalProgress(matchedGoal.id, { workouts: s.workouts, todayIso: today.date })
        : null,
    [matchedGoal, s.workouts, today.date]
  );
  const recoveryBase = userBaselineBefore(s.days, (d) => d.recovery);
  const sessionRec = recommendSession(today.recovery, load);

  const prev7 = s.days.slice(-8, -1);
  const hrvBase = baselineAndSd(prev7, (d) => d.hrv);
  const rhrBase = baselineAndSd(prev7, (d) => d.restingHR);
  const calBase = baselineAndSd(prev7, (d) => d.calories);
  const skinBase = baselineAndSd(prev7, (d) => d.skinTemp);
  const hrNow = s.liveHr?.value ?? s.hrNow;
  const hrZone = zoneFor(hrNow, hrMax(s.profile.age));

  const week = useMemo(() => {
    const ws = addDaysIso(s.days[s.days.length - 1].date, -6); // rolling 7 days
    let km = 0;
    let sessions = 0;
    let sec = 0;
    for (const w of s.workouts) {
      if (w.startIso.slice(0, 10) >= ws) {
        km += w.distanceM;
        sessions++;
        sec += w.durationSec;
      }
    }
    return { km, sessions, sec };
  }, [s.workouts, s.days]);

  const sleep = today.sleep;
  const totalSleep = Math.max(1, sleep.deepMin + sleep.remMin + sleep.lightMin + sleep.awakeMin);
  const stages = [
    { label: "Deep", min: sleep.deepMin, color: "#677e61" },
    { label: "REM", min: sleep.remMin, color: "#bd4444" },
    { label: "Light", min: sleep.lightMin, color: "#c98a2d" },
    { label: "Awake", min: sleep.awakeMin, color: "#9a8b7c" },
  ];
  const sleepColor =
    sleep.score >= 67 ? COLOR_HEX.green : sleep.score >= 34 ? COLOR_HEX.yellow : COLOR_HEX.red;

  const learn = learningStatus(s.profile.profileCreatedAt);
  // A brand-new real account (inside the 7-day baseline window) shows honest
  // "learning" states instead of computed scores from insufficient data. Demo
  // accounts backdate profileCreatedAt so they're always learned.
  const learning = !learn.learned;
  // Raw vitals show as soon as real data exists (a synced device slot, a live
  // BLE stream, or an actual reading in today's row) — only the AI-derived and
  // baseline scores wait for the 7-day learning window.
  const hasRealData =
    s.devices.length > 0 ||
    s.bleConnected ||
    today.hrv > 0 ||
    today.restingHR > 0 ||
    today.steps > 0 ||
    today.sleep.durationMin > 0 ||
    today.skinTemp > 0 ||
    today.spo2 > 0;
  const aiInput = {
    age: s.profile.age,
    sex: s.profile.sex,
    weightKg: s.profile.weightKg,
    heightCm: s.profile.heightCm,
    restingHR: today.restingHR,
    hrv: today.hrv,
    days: s.days,
  };
  const ai = useMemo(() => computeAiMetrics(aiInput), [aiInput]);
  const aiRows = useMemo(() => aiMetricExplainers(ai, aiInput), [ai, aiInput]);

  // "Beat last week" — rolling 7-day comparison + training streak
  const weekCompare = useMemo(
    () =>
      weeklyComparison({
        workouts: s.workouts,
        habits: s.habits,
        days: s.days,
        todayIso: today.date,
      }),
    [s.workouts, s.habits, s.days, today]
  );

  // Weekly digest (Monday-morning retrospective) inputs
  const digestInput: DigestInput = useMemo(
    () => ({
      days: s.days,
      workouts: s.workouts,
      habits: s.habits,
      todayIso: today.date,
      goal: s.profile.goal,
    }),
    [s.days, s.workouts, s.habits, s.profile.goal, today]
  );

  // Race plan (reverse periodization) — null until a race is set
  const racePlan = useMemo(() => {
    if (!s.profile.race) return null;
    const longest = Math.max(
      0,
      ...s.workouts.filter((w) => w.type === "run" || w.type === "trail").map((w) => w.distanceM / 1000)
    );
    return buildRacePlan({ race: s.profile.race, todayIso: today.date, currentLongRunKm: longest || undefined });
  }, [s.profile.race, s.workouts, today]);
  const racePhase = racePlan ? phaseNow(racePlan, today.date) : null;
  const raceTodaySession = racePlan ? planSessionForDate(racePlan, today.date) : null;
  const raceAdjusted = racePlan ? recoveryAdjustedSession(raceTodaySession, today.recovery) : null;

  // A no-device account gets "—" placeholders with a waiting note instead of
  // zeroes that read like real data.
  const waiting = <span className="hint-inline">waiting for a device</span>;
  // Heart rate shows a number only when there's a real live reading — never a
  // placeholder (the sim is demo-only now, and real accounts report no HR
  // until a device streams). Other vitals show once the account has any real
  // data; otherwise the honest "waiting" note.
  const liveHrNow = s.liveHr?.value ?? (s.hrNow > 0 ? s.hrNow : null);
  // No live stream? Show the latest reading the device pushed today, so real
  // users get a number without a BLE connection (the watch/ring sync via
  // Health Connect instead).
  const lastHr = (today.intraday?.hr ?? []).reduce<{ t: number; value: number } | null>(
    (a, b) => (!a || b.t >= a.t ? b : a),
    null
  );
  const hrCardValue = liveHrNow != null ? `${liveHrNow}` : lastHr != null ? `${lastHr.value}` : "—";
  const hrCardSub = liveHrNow != null ? (s.bleConnected ? "Live BLE" : <>Zone {hrZone} · live</>) : lastHr != null ? `last reading · ${fmtClock12(lastHr.t)}` : waiting;
  const metricCards: { key: MetricKey; icon: string; label: string; value: string; unit?: string; sub: ReactNode }[] = [
    { key: "hr", icon: "❤️", label: "Heart rate", value: hrCardValue, unit: "bpm", sub: hrCardSub },
    // Overnight vitals show "—" until THIS day has a reading — a 0 would read
    // like a real (bad) measurement. Accruing counters (steps/calories/zone)
    // show 0 honestly once the account has any data.
    { key: "hrv", icon: "🧠", label: "HRV", value: today.hrv > 0 ? `${today.hrv}` : "—", unit: "ms", sub: today.hrv > 0 ? <Delta value={today.hrv - hrvBase.baseline} suffix=" ms" /> : waiting },
    { key: "restingHR", icon: "🫀", label: "Resting HR", value: today.restingHR > 0 ? `${today.restingHR}` : "—", unit: "bpm", sub: today.restingHR > 0 ? <Delta value={today.restingHR - rhrBase.baseline} suffix=" bpm" invert /> : waiting },
    { key: "steps", icon: "👟", label: "Steps", value: hasRealData ? `${today.steps.toLocaleString()}` : "—", sub: hasRealData ? <>of 8,000 goal</> : waiting },
    { key: "calories", icon: "🔥", label: "Calories", value: hasRealData ? `${today.calories.toLocaleString()}` : "—", unit: "kcal", sub: today.calories > 0 ? <Delta value={today.calories - calBase.baseline} suffix=" kcal" /> : waiting },
    { key: "zoneMinutes", icon: "⚡", label: "Zone minutes", value: hasRealData ? `${today.activeZoneMin}` : "—", unit: "min", sub: hasRealData ? <>WHO target 150/wk</> : waiting },
    { key: "skinTemp", icon: "🌡️", label: "Skin temp", value: today.skinTemp > 0 ? `${today.skinTemp.toFixed(1)}` : "—", unit: "°C", sub: today.skinTemp > 0 ? <Delta value={today.skinTemp - skinBase.baseline} suffix="°" /> : waiting },
    { key: "spo2", icon: "🫁", label: "SpO₂", value: today.spo2 > 0 ? `${today.spo2.toFixed(0)}` : "—", unit: "%", sub: today.spo2 > 0 ? <>normal ≥ 95%</> : waiting },
  ];

  return (
    <div className="page">
      {!bannerGone && (
        <div className="demo-banner">
          <span>
            🧪 Test build v{APP_VERSION} — your data stays in this browser only.
          </span>
          <button onClick={dismissBanner} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">rythm</span>
        </div>
        <div className="top-right">
          <LiveClock />
          <span className="chip live">
            <span className="dot" />
            {learning ? "—" : hrNow > 0 ? hrNow : "—"} bpm
          </span>
        </div>
      </header>

      {/* Wearable sync status — answers "why is today empty?" right on the
          page. Only appears for real accounts that pulled (demo never does). */}
      {s.wearableSync && (
        <div className={`wearable-note ${s.wearableSync.status}`}>
          {s.wearableSync.status === "ok" ? (
            <span>
              ⌚ <b>{s.wearableSync.days}</b> day{s.wearableSync.days === 1 ? "" : "s"} of wearable
              data synced
              {s.wearableSync.from && s.wearableSync.to
                ? ` (${s.wearableSync.from} – ${s.wearableSync.to})`
                : ""}{" "}
              — your real readings are on this dashboard.
            </span>
          ) : s.wearableSync.status === "empty" ? (
            <span>
              ⌚ No wearable data synced yet — open the <b>Health</b> tab, tap <b>Read</b>, then
              come back here. Your real readings appear automatically.
            </span>
          ) : (
            <span>
              ⌚ Wearable sync hit a snag: {s.wearableSync.error ?? "try reopening the app"}. If
              it persists, check that the Health tab said its sync succeeded.
            </span>
          )}
        </div>
      )}

      {/* Rythm Score — the signature metric. New accounts see the learning
          window until a real baseline exists (demo accounts are backdated). */}
      {learning ? (
        <div className="card">
          <div className="ai-learning">
            <div className="ai-learning-head">
              💠 Rythm Score <span className="pill pill-neutral">learning</span>
            </div>
            <p className="ai-learning-body">
              Your signature metric — recovery, sleep, training, habits and consistency rolled
              into one 0–100 score. rythm is building a baseline that&apos;s <b>yours</b>; in{" "}
              <b>{learn.daysLeft} day{learn.daysLeft === 1 ? "" : "s"}</b> your first Rythm Score
              unlocks with a full breakdown of why you got it and how to raise it.
            </p>
            <div className="ai-learning-bar">
              <div
                className="ai-learning-fill"
                style={{ width: `${(learn.elapsed / AI_LEARNING_DAYS) * 100}%` }}
              />
            </div>
            <div className="ai-learning-meta">
              {learn.elapsed}/{AI_LEARNING_DAYS} days of data · connect a device or record workouts
            </div>
          </div>
        </div>
      ) : (
      <button
        className="rythm-card"
        style={{ borderColor: rythm.color === "green" ? "var(--sage-30)" : rythm.color === "yellow" ? "var(--warn-16)" : "var(--bad-14)" }}
        onClick={() => setRythmOpen(true)}
      >
        <div className="rythm-head">
          <div className="rythm-title">
            <span className="rythm-logo">💠</span>
            Rythm Score
          </div>
          <Pill tone={rythm.color === "green" ? "good" : rythm.color === "yellow" ? "warn" : "bad"}>
            {rythm.score}
          </Pill>
        </div>
        <div className="rythm-row">
          {rythm.parts.map((p) => (
            <div key={p.key} className="rythm-pillar" title={`${p.label}: ${p.score}`}>
              <span className="rythm-pillar-icon">{p.icon}</span>
              <span className="rythm-pillar-bar">
                <i
                  style={{
                    width: `${p.score}%`,
                    background: p.score >= 67 ? "var(--green)" : p.score >= 34 ? "var(--yellow)" : "var(--red)",
                  }}
                />
              </span>
              <span className="rythm-pillar-score">{p.score}</span>
            </div>
          ))}
        </div>
        <div className="rythm-foot">Tap for the full breakdown — why this score &amp; how to raise it →</div>
      </button>
      )}
      {!learning && (
        <button className="report-link" onClick={() => setReportOpen(true)}>
          📊 Your Rythm Report — the month in one card →
        </button>
      )}

      {/* AI Coach nudge — no data yet means no brief to write */}
      {!learning && (
      <button className="nudge" style={{ borderColor: hex }} onClick={() => onNavigate("coach")}>
        <div className="nudge-head">
          <span className="nudge-title">Morning Readiness Brief</span>
          <span className="nudge-cta">Ask the coach →</span>
        </div>
        <p>{morningBrief(ctx)}</p>
      </button>
      )}

      {/* Hero: recovery (tap → training load) + strain gauges. New accounts
          get a compact "unlocking" note instead of zeroed gauges. */}
      {learning ? (
        <div className="card">
          <div className="ai-learning-head" style={{ marginBottom: 8 }}>
            💚 Recovery · Strain · Readiness
          </div>
          <p className="ai-learning-body" style={{ marginBottom: 0 }}>
            These scores are computed from <b>your</b> baselines — HRV, resting heart rate and
            sleep compared over a rolling week. They unlock once the baseline window closes in{" "}
            <b>{learn.daysLeft} day{learn.daysLeft === 1 ? "" : "s"}</b>.
          </p>
        </div>
      ) : (
      <div className="hero">
        <button className="hero-gauge clickable" onClick={() => setLoadOpen(true)}>
          <div className="gauge-title">
            Recovery
            <Pill tone={color === "green" ? "good" : color === "yellow" ? "warn" : "bad"}>{color}</Pill>
          </div>
          <StrainGauge strain={today.recovery} max={100} color={hex} showTarget={false} />
          <div className="gauge-value" style={{ color: hex }}>{today.recovery}</div>
          <div className="gauge-sub">
            {recoveryBase.learned ? `7-day baseline ${recoveryBase.value.toFixed(0)}` : `learning baseline · ${recoveryBase.daysToLearn}d`}
          </div>
          <div className="hero-link">training load &amp; balance →</div>
        </button>
        <button className="hero-gauge clickable" onClick={() => setStrainOpen(true)}>
          <div className="gauge-title">
            Day Strain
            <span className="gauge-target">target {target.toFixed(1)}</span>
          </div>
          <StrainGauge strain={s.strain} target={target} color={hex} />
          <div className="gauge-value">{s.strain.toFixed(1)}</div>
          <div className="gauge-sub">of {target.toFixed(1)} suggested</div>
          <div className="hero-link">strain breakdown →</div>
        </button>
      </div>
      )}

      {/* Readiness — right under recovery (learning accounts: covered above) */}
      {!learning && (
      <button
        className="readiness-card"
        onClick={() => setReadinessOpen(true)}
        style={{
          borderColor:
            readiness.status === "Ready" ? "var(--sage-30)" : readiness.status === "Moderate" ? "var(--warn-16)" : "var(--bad-14)",
        }}
      >
        <div className="rd-card-head">
          <span className="rd-card-title">🎯 Readiness</span>
          <span className="rd-card-score" style={{ color: readiness.score >= 70 ? "var(--green)" : readiness.score >= 40 ? "var(--yellow)" : "var(--red)" }}>
            {readiness.score}
          </span>
          <Pill tone={readiness.status === "Ready" ? "good" : readiness.status === "Moderate" ? "warn" : "bad"}>
            {readiness.status}
          </Pill>
        </div>
        <div className="progress" style={{ margin: "6px 0 6px" }}>
          <div
            className="progress-fill"
            style={{ width: `${readiness.score}%`, background: readiness.score >= 70 ? "var(--green)" : readiness.score >= 40 ? "var(--yellow)" : "var(--red)" }}
          />
        </div>
        <p className="rd-card-verdict">{readiness.verdict}</p>
      </button>
      )}

      {/* Sleep score — whole card opens the detail + sleep coach. A real
          night shows the score immediately; no sleep data gets an honest
          empty state instead of a score of 0. */}
      {sleep.durationMin <= 0 ? (
        <div className="card sleep-card">
          <div className="section-head" style={{ marginBottom: 10 }}>
            <h3>Sleep score</h3>
          </div>
          <div className="sleep-score-row">
            <div className="sleep-score-big" style={{ color: "var(--text-faint)" }}>
              —
              <span className="sleep-score-total">/100</span>
            </div>
            <div className="sleep-score-side">
              <div className="sleep-score-meta">No sleep data yet — wear a device overnight</div>
              <div className="progress">
                <div className="progress-fill" style={{ width: "0%", background: "var(--border-strong)" }} />
              </div>
            </div>
          </div>
          <div className="hint-inline" style={{ marginTop: 8 }}>
            The score + sleep coach appear once a night is recorded.
          </div>
        </div>
      ) : (
      <button className="card sleep-card" onClick={() => setDetail("sleep")}>
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h3>Sleep score</h3>
          <span className="link-btn">detail + sleep coach →</span>
        </div>
        <div className="sleep-score-row">
          <div className="sleep-score-big">
            {sleep.score}
            <span className="sleep-score-total">/100</span>
          </div>
          <div className="sleep-score-side">
            <div className="sleep-score-meta">
              {Math.floor(sleep.durationMin / 60)}h {sleep.durationMin % 60}m · need{" "}
              {Math.floor(sleep.needMin / 60)}h {sleep.needMin % 60}m
              {sleep.durationMin < sleep.needMin && (
                <span className="debt"> · {sleep.needMin - sleep.durationMin}m behind</span>
              )}
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${sleep.score}%`, background: sleepColor }} />
            </div>
          </div>
        </div>
        <div className="stages-bar" style={{ marginTop: 10 }}>
          {stages.map((st) => (
            <div key={st.label} style={{ width: `${(st.min / totalSleep) * 100}%`, background: st.color }} title={st.label} />
          ))}
        </div>
      </button>
      )}

      {/* Today's metrics — organized grid, every card opens its detail view */}
      <Section title="Today's metrics">
        <div className="metric-grid">
          {metricCards.map((m) => (
            <button key={m.key} className="metric-card" onClick={() => setDetail(m.key)}>
              <div className="mc-head">
                <span className="mc-icon">{m.icon}</span>
                <span className="mc-label">{m.label}</span>
              </div>
              <div className="mc-value">
                {m.value}
                {m.unit && <span className="mc-unit"> {m.unit}</span>}
              </div>
              <div className="mc-sub">{m.sub}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* AI-derived performance metrics — locked until the baseline is learned */}
      <Section
        title="AI metrics"
        right={
          <span className="hint-inline">
            {learn.learned ? "VO₂max · bio age · more" : `baseline in ${learn.daysLeft}d`}
          </span>
        }
      >
        {learn.learned ? (
          <button className="ai-card" onClick={() => setAiOpen(true)}>
            <div className="ai-card-grid">
              <div className="ai-cell">
                <span className="ai-cell-label">VO₂max</span>
                <span className="ai-cell-value">{ai.vo2max.toFixed(1)}</span>
                <span className="ai-cell-sub" style={{ color: "var(--green)" }}>{ai.vo2Label}</span>
              </div>
              <div className="ai-cell">
                <span className="ai-cell-label">Biological age</span>
                <span className="ai-cell-value">{ai.biologicalAge.toFixed(0)}</span>
                <span className="ai-cell-sub">you're {s.profile.age}</span>
              </div>
              <div className="ai-cell">
                <span className="ai-cell-label">Fitness score</span>
                <span className="ai-cell-value">{ai.fitnessScore}</span>
                <span className="ai-cell-sub">{ai.fitnessLabel}</span>
              </div>
              <div className="ai-cell">
                <span className="ai-cell-label">Training status</span>
                <span className="ai-cell-value" style={{ fontSize: 14 }}>{ai.trainingStatus}</span>
                <span className="ai-cell-sub">{ai.recoveryTrend}% recovery trend</span>
              </div>
            </div>
            <div className="ai-card-foot">How we got these numbers — tap to see the formulas →</div>
          </button>
        ) : (
          <button className="ai-card" onClick={() => setAiOpen(true)}>
            <div className="ai-learning">
              <div className="ai-learning-head">🧬 Learning your baseline</div>
              <p className="ai-learning-body">
                We&apos;re watching your HRV, resting heart rate, sleep and recovery to build a
                baseline that&apos;s <b>yours</b> — not an average. In{" "}
                <b>{learn.daysLeft} day{learn.daysLeft === 1 ? "" : "s"}</b> you&apos;ll get your
                VO₂max, biological age, fitness score and training status.
              </p>
              <div className="ai-learning-bar">
                <div
                  className="ai-learning-fill"
                  style={{ width: `${(learn.elapsed / AI_LEARNING_DAYS) * 100}%` }}
                />
              </div>
              <div className="ai-learning-meta">
                {learn.elapsed}/{AI_LEARNING_DAYS} days of data · keep wearing your device
              </div>
            </div>
          </button>
        )}
      </Section>

      {/* Goal progress dashboard */}
      {goalProgress && (
        <Section
          title="Goal progress"
          right={
            <span className="hint-inline">
              {goalProgress.goal.icon} {goalProgress.goal.label}
            </span>
          }
        >
          <button className="gp-card" onClick={() => setGoalOpen(true)}>
            <div className="gp-card-top">
              <span className="gp-card-pct">{goalProgress.pct}%</span>
              <span className="gp-card-headline">{goalProgress.headline}</span>
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${goalProgress.pct}%`, background: "var(--green)" }} />
            </div>
            <div className="gp-card-mid">{goalProgress.current}</div>
            <div className="gp-card-foot">Everything you've done &amp; what's next — tap to see the full plan →</div>
          </button>
        </Section>
      )}

      {/* Beat last week — hidden when the user toggled it off in Settings,
          or while the baseline window is still learning (no history to beat). */}
      {!learning && s.features.beatLastWeek && (
        <button className="card bw-card" onClick={() => onNavigate("activity")}>
          <div className="section-head" style={{ marginBottom: 10 }}>
            <h3>vs last week</h3>
            <span
              className={`pill ${
                weekCompare.ahead ? "pill-good" : weekCompare.sessionsDelta < 0 ? "pill-bad" : "pill-neutral"
              }`}
            >
              {weekCompare.ahead ? "ahead" : weekCompare.sessionsDelta < 0 ? "behind" : "even"}
            </span>
          </div>
          <p className="bw-headline">{weekCompare.headline}</p>
          <div className="bw-grid">
            <div className="bw-stat">
              <span className="bw-num">
                {weekCompare.thisWeek.sessions}
                <span className="bw-sub"> / {weekCompare.lastWeek.sessions}</span>
              </span>
              <span className="bw-label">sessions</span>
            </div>
            <div className="bw-stat">
              <span className="bw-num">
                {fmtKm(weekCompare.thisWeek.km)}
                <span className="bw-sub"> / {fmtKm(weekCompare.lastWeek.km)}</span>
              </span>
              <span className="bw-label">distance</span>
            </div>
            <div className="bw-stat">
              <span className="bw-num">
                {weekCompare.consistencyPct}%
                <span className="bw-sub"> habits</span>
              </span>
              <span className="bw-label">consistency</span>
            </div>
          </div>
        </button>
      )}

      {/* Race plan — reverse periodization */}
      <button className="card race-card" onClick={() => setRaceOpen(true)}>
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h3>🏁 Race plan</h3>
          <span className="link-btn">{racePlan ? "view plan →" : "set one up →"}</span>
        </div>
        {racePlan && racePhase && raceAdjusted ? (
          <>
            <div className="race-card-top">
              <span className="race-card-dist">{raceDistanceLabel(racePlan.race.distanceKm)}</span>
              <span className={`phase-chip phase-${racePhase.phase}`}>{racePhase.label}</span>
              <span className="race-card-count">in {racePlan.countdownDays}d</span>
            </div>
            <div className="race-card-today">
              <b>Today:</b> {raceAdjusted.title} — {raceAdjusted.desc}
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            Pick a distance and race day — rythm reverse-builds your base → build → peak → taper
            plan and adjusts it to your recovery every day.
          </p>
        )}
      </button>

      {/* Trends — draw whenever the account has readings; the learning window
          only gates the computed SCORES, never the raw data the user can see. */}
      <div className="grid-2">
        <Section title="HRV · 7 days">
          {s.days.slice(-7).some((d) => d.hrv > 0) ? (
            <div className="spark-wrap">
              <Sparkline data={s.days.slice(-7).map((d) => d.hrv)} color="#73976a" w={160} h={46} />
              <div className="spark-range">
                {Math.min(...s.days.slice(-7).map((d) => d.hrv))}–{Math.max(...s.days.slice(-7).map((d) => d.hrv))} ms
              </div>
            </div>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              No data yet — your first readings will appear here.
            </p>
          )}
        </Section>
        <Section title="Recovery · 7 days">
          {s.days.slice(-7).some((d) => d.recovery > 0) ? (
            <Bars
              data={s.days.slice(-7).map((d) => ({ label: d.date.slice(8), value: d.recovery }))}
              color="#bd4444"
              height={56}
            />
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              Waiting for your first recovery score.
            </p>
          )}
        </Section>
      </div>

      {/* Weekly training */}
      <Section
        title="This week"
        right={<button className="link-btn" onClick={() => onNavigate("activity")}>View →</button>}
      >
        <div className="week-grid">
          <div className="week-stat">
            <span className="week-num">{fmtKm(week.km)}</span>
            <span className="week-label">distance</span>
          </div>
          <div className="week-stat">
            <span className="week-num">{week.sessions}</span>
            <span className="week-label">sessions</span>
          </div>
          <div className="week-stat">
            <span className="week-num">{fmtDuration(week.sec)}</span>
            <span className="week-label">time</span>
          </div>
        </div>
        <button className="challenge-entry" onClick={() => setChallengesOpen(true)}>
          <span>🥇 Group challenges</span>
          <span className="challenge-entry-count">{s.challenges.length}</span>
          <span className="link-btn">{s.challenges.length ? "open →" : "create one →"}</span>
        </button>
        {s.workouts.slice(0, 3).map((w) => {
          const def = activityDef(w.type);
          return (
            <div key={w.id} className="mini-workout">
              <span className="mini-icon">{def.icon}</span>
              <div className="mini-body">
                <div className="mini-title">{w.title}</div>
                <div className="mini-meta">
                  {new Date(w.startIso).toLocaleDateString(undefined, { weekday: "short" })} · {fmtKm(w.distanceM)} · {fmtDuration(w.durationSec)}
                </div>
              </div>
              <span className="mini-strain">strain {w.strain.toFixed(1)}</span>
            </div>
          );
        })}
      </Section>

      {/* Weekly digest — hidden when toggled off in Settings, or while the
          baseline window is still learning (nothing to review yet). */}
      {!learning && s.features.weeklyDigest && (
        <button className="card digest-card" onClick={() => setDigestOpen(true)}>
          <div className="section-head" style={{ marginBottom: 10 }}>
            <h3>Weekly digest</h3>
            <span className="link-btn">read it →</span>
          </div>
          <p className="digest-preview">
            Your last 7 days, reviewed — what worked, what didn&apos;t, and the plan for next week.
          </p>
        </button>
      )}

      {/* Devices strip */}
      <div className="dev-strip">
        {s.devices.map((d) => (
          <div key={d.id} className={`dev-chip ${d.connected ? "" : "off"}`} style={{ borderColor: d.color }}>
            <span className="dev-chip-name">{d.name}</span>
            <span className="dev-chip-meta">
              <span className={`dot ${d.connected ? "on" : ""}`} style={{ background: d.connected ? d.color : "#9a8b7c" }} />
              {d.connected ? `${d.battery}%` : "offline"}
            </span>
          </div>
        ))}
      </div>

      {detail && <MetricDetail metric={detail} onClose={() => setDetail(null)} />}
      {aiOpen && (
        <AiMetricsSheet rows={aiRows} ai={ai} input={aiInput} ctx={ctx} learning={learn} onClose={() => setAiOpen(false)} />
      )}
      {rythmOpen && <RythmScoreSheet rythm={rythm} ctx={ctx} onClose={() => setRythmOpen(false)} />}
      {reportOpen && <RythmReportSheet onClose={() => setReportOpen(false)} />}
      {challengesOpen && <ChallengesSheet onClose={() => setChallengesOpen(false)} />}
      {loadOpen && (
        <LoadBalanceSheet
          load={load}
          recovery={today.recovery}
          rec={sessionRec}
          recoveryBaseline={recoveryBase}
          ctx={ctx}
          onClose={() => setLoadOpen(false)}
        />
      )}
      {strainOpen && (
        <StrainDetailSheet
          strain={s.strain}
          target={target}
          recovery={today.recovery}
          load={load}
          rec={sessionRec}
          history={s.days}
          onClose={() => setStrainOpen(false)}
        />
      )}
      {readinessOpen && <ReadinessSheet readiness={readiness} ctx={ctx} onClose={() => setReadinessOpen(false)} />}
      {goalOpen && goalProgress && (
        <GoalProgressSheet progress={goalProgress} onClose={() => setGoalOpen(false)} />
      )}
      {digestOpen && <DigestSheet input={digestInput} onClose={() => setDigestOpen(false)} />}
      {raceOpen && <RacePlanSheet onClose={() => setRaceOpen(false)} />}
    </div>
  );
}
