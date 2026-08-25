import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { DailyMetrics, MetricKey } from "../types";
import { metricDef } from "../types";
import { userBaselineBefore } from "../engine/baselines";
import { hrMax, zoneFor } from "../engine/zones";
import { fmtSleep, sleepCoachTips } from "../engine/sleep";
import { AI_LEARNING_DAYS, learningStatus } from "../engine/aiLearning";
import { IntradayChart, Pill, TrendChart } from "./ui";

const GOOD = "#73976a";
const WARN = "#c98a2d";
const BAD = "#a63c3c";

type Status = "good" | "warn" | "bad" | "neutral";

function statusColor(s: Status): string {
  return s === "good" ? GOOD : s === "warn" ? WARN : s === "bad" ? BAD : "#94a3b8";
}

function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Metrics captured as a single overnight reading (the ring's morning analysis). */
const OVERNIGHT: MetricKey[] = ["hrv", "restingHR", "skinTemp", "spo2", "respRate", "sleep"];

/** When the selected day's value for this metric was measured. */
function timeLabelFor(metric: MetricKey, day: DailyMetrics, isToday: boolean): string {
  if (OVERNIGHT.includes(metric)) return `measured ${fmtTime(day.measuredAtMin)}`;
  // steps / calories / zone minutes accrue all day
  return isToday ? "live · all day" : "all day";
}

/** Reword insight text when viewing a past day instead of today. */
function dayify(text: string, isToday: boolean): string {
  if (isToday) return text;
  return text.replace(/Today/g, "That day").replace(/today/g, "that day");
}

/** A day with no recorded vitals at all (fresh real account, no device yet). */
function dayHasData(d: DailyMetrics): boolean {
  return (
    d.hrv > 0 ||
    d.restingHR > 0 ||
    d.steps > 0 ||
    d.skinTemp > 0 ||
    d.spo2 > 0 ||
    d.sleep.durationMin > 0
  );
}

/** Whether the account has EVER recorded anything — vs. just this day being empty. */
function accountHasAnyData(days: DailyMetrics[]): boolean {
  return days.some(dayHasData);
}

/**
 * Shown inside the 7-day baseline window: no fabricated numbers — the app
 * is learning the user's own baselines first (same gate as the dashboard).
 */
function LearningPanel() {
  const s = useStore();
  const learn = learningStatus(s.profile.profileCreatedAt);
  return (
    <div className="metric-detail">
      <div className="hd-section">
        <div className="hd-title">⏳ Still learning your baseline</div>
        <p className="insight">
          rythm is watching your HRV, resting heart rate, sleep and recovery to build a baseline
          that&apos;s <b>yours</b>. In <b>{learn.daysLeft} day{learn.daysLeft === 1 ? "" : "s"}</b> this
          view unlocks with your real numbers — connect a device or record a workout to speed it up.
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
  );
}

/** No data for this metric — either never recorded, or just not on the selected day. */
function NoDataPanel({ what, on }: { what: string; on?: string }) {
  return (
    <div className="metric-detail">
      <div className="hd-section">
        <div className="hd-title">📡 No {what} data yet</div>
        <p className="insight">
          {on
            ? `No ${what} was recorded on ${on}. Tap the arrows to check a different day.`
            : `Nothing has been recorded yet — connect a health device (Health Connect or a BLE band) or
            record a workout, and your ${what} readings will show up here.`}
        </p>
      </div>
    </div>
  );
}

function DayNav({
  date,
  isToday,
  sel,
  total,
  onSelect,
}: {
  date: string;
  isToday: boolean;
  sel: number;
  total: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="day-nav">
      <button className="day-nav-btn" disabled={sel <= 0} onClick={() => onSelect(sel - 1)} aria-label="Previous day">
        ◀
      </button>
      <div className="day-nav-label">
        <span className="day-nav-date">{isToday ? "Today" : fmtDay(date)}</span>
        <span className="day-nav-sub">{isToday ? "· live" : `day ${sel + 1} of ${total}`}</span>
      </div>
      <button
        className="day-nav-btn"
        disabled={sel >= total - 1}
        onClick={() => onSelect(sel + 1)}
        aria-label="Next day"
      >
        ▶
      </button>
    </div>
  );
}

export default function MetricDetail({ metric, onClose }: { metric: MetricKey; onClose: () => void }) {
  const def = metricDef(metric);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="sheet-icon">{def.icon}</span>
          <h2>{def.label}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {metric === "sleep" ? (
            <SleepDetail />
          ) : metric === "hr" ? (
            <HrDetail />
          ) : (
            <NumericDetail metric={metric} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// generic numeric metric — with day navigation + clickable chart points
// ---------------------------------------------------------------------------

function fieldOf(metric: MetricKey): (d: DailyMetrics) => number {
  switch (metric) {
    case "hrv":
      return (d) => d.hrv;
    case "restingHR":
      return (d) => d.restingHR;
    case "steps":
      return (d) => d.steps;
    case "skinTemp":
      return (d) => d.skinTemp;
    case "spo2":
      return (d) => d.spo2;
    case "respRate":
      return (d) => d.respRate;
    case "activeEnergy":
      return (d) => d.activeEnergy;
    case "calories":
      return (d) => d.calories;
    case "zoneMinutes":
      return (d) => d.activeZoneMin;
    default:
      return (d) => d.hrv;
  }
}

function unitOf(metric: MetricKey): string {
  return metricDef(metric).unit ? ` ${metricDef(metric).unit}` : "";
}

function statusFor(metric: MetricKey, today: number, baseline: number): Status {
  switch (metric) {
    case "hrv":
      return today >= baseline ? "good" : today >= baseline * 0.92 ? "warn" : "bad";
    case "restingHR":
      return today <= baseline ? "good" : today <= baseline * 1.05 ? "warn" : "bad";
    case "steps":
      return today >= 8000 ? "good" : today >= 5000 ? "warn" : "bad";
    case "skinTemp": {
      const d = Math.abs(today - baseline);
      return d <= 0.2 ? "good" : d <= 0.4 ? "warn" : "bad";
    }
    case "spo2":
      return today >= 95 ? "good" : today >= 92 ? "warn" : "bad";
    case "respRate":
      return today >= 12 && today <= 18 ? "good" : today >= 10 && today <= 20 ? "warn" : "bad";
    case "activeEnergy":
      return today >= baseline ? "good" : today >= baseline * 0.7 ? "warn" : "bad";
    default:
      return "neutral";
  }
}

function insightFor(metric: MetricKey, today: number, baseline: number, delta: number): string {
  switch (metric) {
    case "hrv":
      return delta >= 0
        ? `HRV is ${Math.round(delta)} ms above your 7-day baseline — a sign the nervous system is recovered and ready for load.`
        : `HRV is ${Math.round(Math.abs(delta))} ms below your 7-day baseline. Lower HRV usually means accumulated fatigue — consider an easier day.`;
    case "restingHR":
      return delta <= 0
        ? `Resting HR is ${Math.abs(delta).toFixed(1)} bpm below baseline — a good sign of recovery.`
        : `Resting HR is ${delta.toFixed(1)} bpm above baseline. An elevated resting HR can indicate stress, poor sleep, or the start of illness.`;
    case "steps":
      return today >= 8000
        ? "On track to hit your 8,000-step target — daily NEAT movement adds up across the week."
        : `You're at ${today.toLocaleString()} steps today. ${8000 - today > 0 ? `${8000 - today} to go for your target.` : ""}`;
    case "skinTemp":
      return Math.abs(delta) > 0.3
        ? `Skin temp is ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}°C vs baseline. Sustained deviation can signal illness or overtraining — watch recovery.`
        : "Skin temp is close to your baseline — no thermal stress signal today.";
    case "spo2":
      return today >= 95
        ? "SpO₂ is in the healthy 95–100% range."
        : "SpO₂ below 95% warrants attention — retest, and if it persists, see a professional.";
    case "respRate":
      return today >= 12 && today <= 18
        ? "Respiratory rate is in the normal 12–18 breaths/min range."
        : "Respiratory rate outside the normal range — correlate with sleep quality and recovery.";
    case "activeEnergy":
      return today >= baseline
        ? "Active calories are at or above your baseline — good daily movement."
        : "Active energy is below your baseline so far today — a bit more movement would help.";
    case "calories":
      return today >= baseline
        ? "Total calories are tracking at or above your daily baseline — consistent with an active day."
        : "Total calories burned are below baseline so far — still early in the day, it climbs as you move.";
    case "zoneMinutes":
      return today >= 150
        ? "You've banked 150+ zone minutes — the WHO weekly target for cardiovascular health."
        : today >= baseline
          ? "Zone minutes are tracking ahead of your 7-day average — good intensity work today."
          : "Zone minutes are building — aim for a little more time in zones 2–4 to hit your weekly target.";
    default:
      return "";
  }
}

function NumericDetail({ metric }: { metric: MetricKey }) {
  const s = useStore();
  const [sel, setSel] = useState(() => s.days.length - 1);
  const isToday = sel === s.days.length - 1;
  const day = s.days[sel];
  if (!dayHasData(day)) {
    // The AI learning window only gates the AI-derived scores — never a raw
    // metric like steps. If THIS day is empty but the account has history,
    // show the day nav so the user can reach it; the "still learning" panel
    // is reserved for accounts that have never recorded anything at all.
    if (!accountHasAnyData(s.days)) {
      if (!learningStatus(s.profile.profileCreatedAt).learned) return <LearningPanel />;
    }
    return (
      <div className="metric-detail">
        <DayNav date={day.date} isToday={isToday} sel={sel} total={s.days.length} onSelect={setSel} />
        <NoDataPanel what={metricDef(metric).label.toLowerCase()} on={isToday ? "today" : day.date} />
      </div>
    );
  }
  const windowed = s.days.slice(0, sel + 1);
  const field = fieldOf(metric);
  const unit = unitOf(metric);
  const base = userBaselineBefore(windowed, field);
  const baseline = base.value;
  const sd = base.sd;
  const current = field(day);
  const status = statusFor(metric, current, baseline);
  const delta = current - baseline;
  const trend: number[] = s.days.map(field);
  const recent7 = windowed.slice(-7).map(field);
  const prior7 = windowed.slice(-14, -7).map(field);
  const slopeAvg =
    recent7.length && prior7.length
      ? recent7.reduce((a, b) => a + b, 0) / recent7.length -
        prior7.reduce((a, b) => a + b, 0) / prior7.length
      : 0;

  const fmt = (v: number) =>
    metric === "steps" || metric === "activeEnergy" || metric === "calories"
      ? Math.round(v).toLocaleString()
      : metric === "skinTemp" || metric === "respRate" || metric === "restingHR"
        ? v.toFixed(1)
        : Math.round(v).toString();

  // Same-day readings from the health bridge (if the device pushed them).
  const intraday = day.intraday?.[metric] ?? [];

  return (
    <div className="metric-detail">
      <DayNav date={day.date} isToday={isToday} sel={sel} total={s.days.length} onSelect={setSel} />

      <div className="detail-hero">
        <div className="detail-value">
          {fmt(current)}
          <span className="detail-unit">{unit}</span>
        </div>
        <Pill tone={status}>{statusLabel(status)}</Pill>
      </div>

      <div className="detail-baseline">
        <div>
          <span className="db-label">7-day baseline</span>
          <span className="db-value">
            {fmt(baseline)}
            {unit}
          </span>
        </div>
        <div>
          <span className="db-label">{isToday ? "Today vs baseline" : "Day vs baseline"}</span>
          <span className="db-value" style={{ color: statusColor(status) }}>
            {delta >= 0 ? "▲ +" : "▼ "}
            {fmt(Math.abs(delta))}
            {unit}
          </span>
        </div>
        <div>
          <span className="db-label">14-day trend</span>
          <span className="db-value" style={{ color: slopeAvg >= 0 ? GOOD : BAD }}>
            {slopeAvg >= 0 ? "↗" : "↘"} {fmt(Math.abs(slopeAvg))}
            {unit}
          </span>
        </div>
      </div>

      {intraday.length >= 2 && (
        <div className="hd-section">
          <div className="hd-title">
            {isToday ? "Today's readings" : "That day's readings"} — the up and down
          </div>
          <IntradayChart samples={intraday} color={statusColor(status)} unit={unit} />
          <p className="hint" style={{ marginTop: 4 }}>
            Tap any point to see the exact time and value that reading was taken.
          </p>
        </div>
      )}

      <div className="hd-title" style={{ marginTop: 10 }}>Last {s.days.length} days</div>
      <TrendChart
        data={trend}
        color={statusColor(status)}
        unit={unit}
        selectedIndex={sel}
        onSelect={setSel}
        times={s.days.map((d, i) => timeLabelFor(metric, d, i === s.days.length - 1))}
      />
      <p className="hint" style={{ marginTop: 4 }}>
        Tap any point on the chart to inspect that day — the arrows step through the history.
      </p>

      <p className="insight">{dayify(insightFor(metric, current, baseline, delta), isToday)}</p>
      {metric === "steps" && intraday.length >= 2 && (
        <p className="insight-meta">
          Steps are Health Connect&apos;s total across every device that writes to it (watch, ring,
          phone) — so the count can be higher than any single device&apos;s own app shows.
        </p>
      )}
      {base.learned ? (
        <p className="insight-meta">
          Baseline learned from your own history — {base.days} days, SD {fmt(sd)}
          {unit}. Values within ±2 SD of baseline are considered normal.
        </p>
      ) : (
        <p className="insight-meta">
          Baseline still learning — {base.daysToLearn} more day{base.daysToLearn === 1 ? "" : "s"} of data needed. Using the {base.days} day{base.days === 1 ? "" : "s"} collected so far.
        </p>
      )}
    </div>
  );
}

function statusLabel(s: Status): string {
  return s === "good" ? "Good" : s === "warn" ? "Watch" : s === "bad" ? "Low" : "Neutral";
}

// ---------------------------------------------------------------------------
// sleep — day navigation + clickable sleep-score chart
// ---------------------------------------------------------------------------

function SleepDetail() {
  const s = useStore();
  const [sel, setSel] = useState(() => s.days.length - 1);
  const isToday = sel === s.days.length - 1;
  const day = s.days[sel];
  const sleep = day.sleep;
  if (sleep.durationMin <= 0) {
    if (!accountHasAnyData(s.days)) {
      if (!learningStatus(s.profile.profileCreatedAt).learned) return <LearningPanel />;
    }
    return (
      <div className="metric-detail">
        <DayNav date={day.date} isToday={isToday} sel={sel} total={s.days.length} onSelect={setSel} />
        <NoDataPanel what="sleep" on={isToday ? "today" : day.date} />
      </div>
    );
  }
  const scores = s.days.map((d) => d.sleep.score);
  const weekScores = s.days.slice(Math.max(0, sel - 6), sel + 1).map((d) => d.sleep.score);
  const weekAvg = weekScores.reduce((a, b) => a + b, 0) / Math.max(1, weekScores.length);
  const carriedDebt = s.days
    .slice(Math.max(0, sel - 3), sel)
    .reduce((a, d) => a + Math.max(0, d.sleep.needMin - d.sleep.durationMin), 0);
  const tips = sleepCoachTips(sleep, weekAvg, carriedDebt);
  const total = Math.max(1, sleep.deepMin + sleep.remMin + sleep.lightMin + sleep.awakeMin);
  const efficiency = (sleep.durationMin / Math.max(1, sleep.durationMin + sleep.awakeMin)) * 100;
  const deepRemPct = ((sleep.deepMin + sleep.remMin) / total) * 100;
  const scoreColor = sleep.score >= 67 ? GOOD : sleep.score >= 34 ? WARN : BAD;
  const debt = Math.max(0, sleep.needMin - sleep.durationMin);
  const stages = [
    { label: "Deep", min: sleep.deepMin, color: "#677e61" },
    { label: "REM", min: sleep.remMin, color: "#bd4444" },
    { label: "Light", min: sleep.lightMin, color: "#c98a2d" },
    { label: "Awake", min: sleep.awakeMin, color: "#9a8b7c" },
  ];

  return (
    <div className="metric-detail">
      <DayNav date={day.date} isToday={isToday} sel={sel} total={s.days.length} onSelect={setSel} />

      <div className="detail-hero">
        <div className="detail-value">
          {sleep.score}
          <span className="detail-unit">/100</span>
        </div>
        <Pill tone={sleep.score >= 67 ? "good" : sleep.score >= 34 ? "warn" : "bad"}>
          {sleep.score >= 67 ? "Good" : sleep.score >= 34 ? "Fair" : "Poor"}
        </Pill>
      </div>

      <div className="sleep-score-bars">
        <div className="ss-row">
          <span>Duration</span>
          <div className="ss-track">
            <div className="ss-fill" style={{ width: `${Math.min(100, (sleep.durationMin / sleep.needMin) * 100)}%`, background: GOOD }} />
          </div>
          <span className="ss-num">
            {fmtSleep(sleep.durationMin / 60)} / {fmtSleep(sleep.needMin / 60)} need
          </span>
        </div>
        <div className="ss-row">
          <span>Efficiency</span>
          <div className="ss-track">
            <div className="ss-fill" style={{ width: `${Math.min(100, efficiency)}%`, background: scoreColor }} />
          </div>
          <span className="ss-num">{efficiency.toFixed(0)}%</span>
        </div>
        <div className="ss-row">
          <span>Deep + REM</span>
          <div className="ss-track">
            <div className="ss-fill" style={{ width: `${Math.min(100, (deepRemPct / 40) * 100)}%`, background: "#c084fc" }} />
          </div>
          <span className="ss-num">{deepRemPct.toFixed(0)}%</span>
        </div>
      </div>

      <div className="stages-bar">
        {stages.map((st) => (
          <div key={st.label} style={{ width: `${(st.min / total) * 100}%`, background: st.color }} title={st.label} />
        ))}
      </div>
      <div className="stages-legend">
        {stages.map((st) => (
          <span key={st.label}>
            <i style={{ background: st.color }} />
            {st.label} {Math.round((st.min / 60) * 10) / 10}h
          </span>
        ))}
      </div>

      <TrendChart
        data={scores}
        color={scoreColor}
        height={104}
        selectedIndex={sel}
        onSelect={setSel}
        times={s.days.map((d) => `measured ${fmtTime(d.measuredAtMin)}`)}
      />
      <p className="hint" style={{ marginTop: 4 }}>
        Sleep score over the last {scores.length} days — tap a point to inspect that night.
      </p>

      <p className="insight">
        {debt > 0
          ? `You${isToday ? "'re" : " were"} ${debt} min short of your ${fmtSleep(sleep.needMin / 60)} need — sleep debt carries into tomorrow and raises your need further.`
          : "You hit your sleep need — debt is being paid down."}{" "}
        Score = 45% duration vs need + 30% efficiency + 25% deep/REM proportion.
      </p>

      <div className="hd-section">
        <div className="hd-title">🧠 Sleep coach</div>
        <div className="coach-tips">
          {tips.map((t, i) => (
            <div key={i} className={`coach-tip ${t.tone}`}>
              <span className="coach-tip-icon">{t.tone === "good" ? "💚" : t.tone === "warn" ? "🟡" : "🔴"}</span>
              <p>{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// live heart rate
// ---------------------------------------------------------------------------

function HrDetail() {
  const s = useStore();
  const today = s.days[s.days.length - 1];
  const max = hrMax(s.profile.age);
  const intradayHr = today.intraday?.hr ?? [];
  const hasIntraday = intradayHr.length >= 2;
  // Live BLE beats the day's readings; otherwise show the latest reading the
  // device pushed today (never a placeholder 0).
  const lastHr = intradayHr.reduce<{ t: number; value: number } | null>(
    (a, b) => (!a || b.t >= a.t ? b : a),
    null
  );
  const live = !!s.liveHr;
  const hr = live ? s.liveHr!.value : lastHr ? lastHr.value : s.hrNow;
  const zone = zoneFor(hr, max);
  const pct = Math.round((hr / max) * 100);
  const source = s.liveHr?.deviceName ?? "—";

  // Zone distribution from REAL pulled samples when a device synced; the
  // demo sim's sample feed is the fallback (demo accounts only).
  const hrPool = hasIntraday
    ? intradayHr.map((x) => x.value)
    : s.samples.filter((x) => x.metric === "hr").map((x) => x.value);
  const zones = useMemo(() => {
    const counts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } as Record<string, number>;
    for (const v of hrPool) counts[`z${zoneFor(v, max)}`]++;
    return counts;
  }, [hrPool, max]);
  const zoneTotal = Math.max(1, zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5);

  // No real device/live stream and no pulled readings? Don't show a
  // placeholder number that reads like a real reading — explain instead.
  if (!s.liveHr && !hasIntraday) {
    if (!accountHasAnyData(s.days)) {
      if (!learningStatus(s.profile.profileCreatedAt).learned) return <LearningPanel />;
    }
    if (hr <= 0) return <NoDataPanel what="heart rate" />;
  }

  const ZONE_COLORS_LOCAL = ["#3b82f6", "#73976a", "#eab308", "#fb923c", "#ef4444"];
  const range = hrPool.length ? Math.min(...hrPool, hr) : hr;
  const rangeMax = hrPool.length ? Math.max(...hrPool, hr) : hr;

  return (
    <div className="metric-detail">
      <div className="detail-hero">
        <div className="detail-value">
          {hr}
          <span className="detail-unit"> bpm</span>
        </div>
        <Pill tone="accent">Zone {zone} · {pct}% HRmax</Pill>
      </div>

      <div className="detail-baseline">
        <div>
          <span className="db-label">Today's range</span>
          <span className="db-value">
            {range}–{rangeMax} bpm
          </span>
        </div>
        <div>
          <span className="db-label">Source device</span>
          <span className="db-value">{source}</span>
        </div>
        <div>
          <span className="db-label">HRmax estimate</span>
          <span className="db-value">{max} bpm</span>
        </div>
      </div>

      {hasIntraday && (
        <div className="hd-section">
          <div className="hd-title">Today's heart rate — hour by hour</div>
          <IntradayChart samples={intradayHr} color="#bd4444" unit=" bpm" />
          <p className="hint" style={{ marginTop: 4 }}>
            Tap any point to see your exact heart rate at that time.
          </p>
        </div>
      )}

      <div className="zones-bar" style={{ height: 10 }}>
        {(["z1", "z2", "z3", "z4", "z5"] as const).map((z, i) => (
          <div
            key={z}
            style={{ width: `${(zones[z] / zoneTotal) * 100}%`, background: ZONE_COLORS_LOCAL[i] }}
            title={`Z${i + 1}: ${zones[z]} ${hasIntraday ? "readings" : "min"} today`}
          />
        ))}
      </div>
      <div className="zones-legend">
        {ZONE_COLORS_LOCAL.map((c, i) => (
          <span key={i}>
            <i style={{ background: c }} />Z{i + 1} {zones[`z${i + 1}`]}
          </span>
        ))}
      </div>

      <p className="insight">
        {live
          ? `Live HR reads ${hr} bpm — Zone ${zone} (${pct}% of an estimated ${max} bpm max). `
          : lastHr
            ? `Latest reading today: ${hr} bpm at ${fmtTime(lastHr.t)} — Zone ${zone} (${pct}% of an estimated ${max} bpm max). `
            : `HR reads ${hr} bpm — Zone ${zone} (${pct}% of an estimated ${max} bpm max). `}
        {zone >= 4
          ? "You're in hard territory; strain accrues fast here."
          : zone === 3
            ? "Moderate effort — this is where aerobic fitness is built."
            : "Low-intensity zone — recovery-friendly pacing."}{" "}
        Readings are merged from {source === "—" ? "your devices" : source} via the priority engine.
      </p>
      {today.sleep.durationMin > 0 && (
        <p className="insight-meta">Resting HR this morning: {today.restingHR} bpm.</p>
      )}
    </div>
  );
}
