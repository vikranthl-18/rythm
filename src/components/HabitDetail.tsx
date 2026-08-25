import { useEffect, useMemo, useState } from "react";
import type { DailyMetrics, Habit } from "../types";
import { addDaysIso, todayIso } from "../lib/rng";
import { useStore } from "../store";
import {
  autoCompleted,
  completedOn,
  completionRate,
  currentStreak,
  habitDueOn,
  longestStreak,
  targetLabel,
} from "../engine/habits";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO dates for the month containing `iso`, padded with nulls to start on Sunday. */
function monthDays(iso: string): (string | null)[] {
  const d = new Date(iso + "T12:00:00");
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const pad = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const out: (string | null)[] = Array(pad).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    out.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    );
  }
  return out;
}

function fmtValue(h: Habit, v: number): string {
  if (h.targetType === "BOOLEAN") return v >= 1 ? "✓" : "—";
  if (h.targetType === "DURATION" && h.targetValue < 100)
    return `${v}${h.unit || " min"}`;
  return h.unit ? `${v} ${h.unit}` : `${v}`;
}

/** One row of the fix-a-past-day editor (last 14 days). */
function PastDayRow({
  h,
  iso,
  today,
  todayDay,
}: {
  h: Habit;
  iso: string;
  today: string;
  todayDay: DailyMetrics | null;
}) {
  const s = useStore();
  const due = habitDueOn(h, iso);
  const done = completedOn(h, iso, today, todayDay, { auto: s.features.autoHabits });
  const logVal = h.logs[iso];
  const [val, setVal] = useState(logVal !== undefined ? String(logVal) : "");
  useEffect(() => {
    setVal(logVal !== undefined ? String(logVal) : "");
  }, [logVal]);

  const dateLabel = new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  if (h.targetType === "BOOLEAN") {
    return (
      <div className="past-day">
        <span className="pd-date">{dateLabel}</span>
        {!due && <span className="pd-due">not scheduled</span>}
        <button
          className={`chip-btn sm ${done ? "" : "ghost"}`}
          disabled={!due}
          onClick={() => s.setHabitLog(h.id, iso, done ? null : 1)}
        >
          {done ? "✓ done" : "mark done"}
        </button>
      </div>
    );
  }

  return (
    <div className="past-day">
      <span className="pd-date">{dateLabel}</span>
      <span className={`pd-status ${done ? "yes" : "no"}`}>
        {due ? (done ? "met" : "missed") : "n/a"}
      </span>
      <input
        className="pd-input"
        type="number"
        value={val}
        disabled={!due}
        placeholder="—"
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val.trim() === "") s.setHabitLog(h.id, iso, null);
          else {
            const n = parseFloat(val);
            if (!Number.isNaN(n)) s.setHabitLog(h.id, iso, n);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export default function HabitDetail({
  h,
  todayDay,
  onClose,
}: {
  h: Habit;
  todayDay: DailyMetrics | null;
  onClose: () => void;
}) {
  const s = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = todayIso();
  const autoOn = s.features.autoHabits; // user may disable biometric auto-completion
  const autoOpts = { auto: autoOn };
  const cur = currentStreak(h, today, todayDay, autoOpts);
  const longest = longestStreak(h, today, todayDay, autoOpts);
  const rate = completionRate(h, today, todayDay, 28, autoOpts);
  const auto = autoOn && autoCompleted(h, todayDay) && h.autoMetric;

  const calendar = useMemo(() => monthDays(today), [today]);

  // last 8 weeks: {iso start, done, due}
  const weeks = useMemo(() => {
    const out: { label: string; done: number; due: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      // start of week = the Sunday `w` weeks before this Sunday
      const d = new Date(today + "T12:00:00");
      const thisSunday = d.getDate() - d.getDay();
      const start = new Date(d.getFullYear(), d.getMonth(), thisSunday - w * 7);
      let done = 0;
      let due = 0;
      for (let i = 0; i < 7; i++) {
        const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate() + i).padStart(2, "0")}`;
        if (!habitDueOn(h, iso)) continue;
        due++;
        if (completedOn(h, iso, today, todayDay, autoOpts)) done++;
      }
      out.push({
        label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        done,
        due,
      });
    }
    return out;
  }, [h, today, todayDay, autoOn]);

  const totalDone = Object.keys(h.logs).filter((d) =>
    completedOn(h, d, today, todayDay, autoOpts)
  ).length;
  const bestWeek = weeks.reduce((a, b) => Math.max(a, b.done), 0);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="sheet-icon" style={{ background: `${h.color}1f` }}>
            {h.icon}
          </span>
          <div>
            <h2>{h.title}</h2>
            <div className="sheet-sub">
              {targetLabel(h)}
              {auto && <span className="auto-badge">auto-synced</span>}
            </div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          {/* stats row */}
          <div className="habit-detail-stats">
            <div className="hd-stat">
              <span className="hd-value">🔥 {cur}</span>
              <span className="hd-label">current streak</span>
            </div>
            <div className="hd-stat">
              <span className="hd-value">🏆 {longest}</span>
              <span className="hd-label">longest</span>
            </div>
            <div className="hd-stat">
              <span className="hd-value">{rate}%</span>
              <span className="hd-label">completion</span>
            </div>
            <div className="hd-stat">
              <span className="hd-value">{totalDone}</span>
              <span className="hd-label">total days</span>
            </div>
          </div>

          {/* weekly bars */}
          <div className="hd-section">
            <div className="hd-title">
              Weekly completion <span className="hint-inline">last 8 weeks</span>
            </div>
            <div className="week-bars">
              {weeks.map((w) => {
                const pct = w.due ? w.done / w.due : 0;
                return (
                  <div key={w.label} className="week-bar" title={`${w.label} · ${w.done}/${w.due}`}>
                    <div className="week-bar-track">
                      <div
                        className="week-bar-fill"
                        style={{ height: `${Math.max(8, pct * 100)}%`, background: h.color }}
                      />
                    </div>
                    <span className="week-bar-label">{w.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="hd-meta">
              Best week: <b>{bestWeek}</b> completions ·{" "}
              {weeks[weeks.length - 1]?.done}/{weeks[weeks.length - 1]?.due} this week
            </div>
          </div>

          {/* month calendar */}
          <div className="hd-section">
            <div className="hd-title">
              {MONTHS[new Date(today + "T12:00:00").getMonth()]}{" "}
              {new Date(today + "T12:00:00").getFullYear()}
            </div>
            <div className="cal-grid">
              {WEEKDAY_LABELS.map((l, i) => (
                <span key={i} className="cal-dow">{l}</span>
              ))}
              {calendar.map((iso, i) =>
                iso === null ? (
                  <span key={`x${i}`} className="cal-cell empty" />
                ) : (
                  <div
                    key={iso}
                    className={`cal-cell ${
                      iso === today ? "is-today" : ""
                    } ${habitDueOn(h, iso) ? "due" : "nodue"} ${
                      completedOn(h, iso, today, todayDay, autoOpts) ? "done" : ""
                    }`}
                    style={
                      completedOn(h, iso, today, todayDay, autoOpts)
                        ? { background: h.color, borderColor: h.color }
                        : undefined
                    }
                    title={`${iso}${h.logs[iso] !== undefined ? ` · ${fmtValue(h, h.logs[iso])}` : ""}`}
                  >
                    <span className="cal-num">{Number(iso.slice(8))}</span>
                    {completedOn(h, iso, today, todayDay, autoOpts) && <span className="cal-check">✓</span>}
                  </div>
                )
              )}
            </div>
            <div className="hd-meta">
              <span className="dot-legend" style={{ background: h.color }} /> completed ·{" "}
              <span className="dot-legend dim" /> not due / missed
            </div>
          </div>

          {/* fix a past day */}
          <div className="hd-section">
            <div className="hd-title">Fix a past day</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Made a mistake? Toggle a day or type the real value — streaks and stats
              recompute instantly.
            </p>
            <div className="past-days">
              {Array.from({ length: 14 })
                .map((_, i) => addDaysIso(today, -(13 - i)))
                .map((iso) => (
                  <PastDayRow key={iso} h={h} iso={iso} today={today} todayDay={todayDay} />
                ))}
            </div>
          </div>

          {/* recent values for numeric habits */}
          {h.targetType !== "BOOLEAN" && (
            <div className="hd-section">
              <div className="hd-title">Recent values</div>
              <div className="recent-values">
                {Object.entries(h.logs)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .slice(0, 7)
                  .map(([iso, v]) => (
                    <div key={iso} className="rv-row">
                      <span className="rv-date">
                        {new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="rv-value">{fmtValue(h, v)}</span>
                      <span className={`rv-ok ${completedOn(h, iso, today, todayDay, autoOpts) ? "yes" : "no"}`}>
                        {completedOn(h, iso, today, todayDay, autoOpts) ? "met" : "missed"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* delete */}
          <button
            className={`btn-ghost btn-danger ${confirmDelete ? "confirm" : ""}`}
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              s.removeHabit(h.id);
              onClose();
            }}
          >
            {confirmDelete
              ? "Tap again to confirm — this deletes all history"
              : "Delete habit"}
          </button>
        </div>
      </div>
    </div>
  );
}
