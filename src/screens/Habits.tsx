import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { DailyMetrics, Habit, HabitFrequency, HabitTargetType } from "../types";
import { addDaysIso, todayIso, uid } from "../lib/rng";
import {
  autoCompleted,
  completedOn,
  completionRate,
  currentStreak,
  habitDueOn,
  longestStreak,
  targetLabel,
  weekProgress,
} from "../engine/habits";
import { Section } from "../components/ui";
import HabitDetail from "../components/HabitDetail";

const ICONS = ["✅", "💧", "🏃", "🧘", "🏋️", "📖", "🥗", "🦷", "💊", "🌅", "🫁", "🧠"];
const COLORS = ["#818cf8", "#38bdf8", "#73976a", "#a3e635", "#c98a2d", "#c084fc", "#f472b6", "#a63c3c"];
const AUTO_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Manual (no auto-sync)" },
  { value: "sleepDuration", label: "Sleep duration (h)" },
  { value: "steps", label: "Steps" },
  { value: "hrv", label: "HRV (ms)" },
  { value: "restingHR", label: "Resting HR (bpm)" },
  { value: "skinTemp", label: "Skin temp (°C)" },
  { value: "spo2", label: "SpO₂ (%)" },
  { value: "activeEnergy", label: "Active energy (kcal)" },
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function Habits() {
  const s = useStore();
  const today = todayIso();
  const todayDay = s.days[s.days.length - 1];
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailHabit = detailId ? s.habits.find((h) => h.id === detailId) ?? null : null;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">Habits</span>
        </div>
        <button className="chip-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "+ New habit"}
        </button>
      </header>

      {showForm && <HabitForm onDone={() => setShowForm(false)} />}

      {s.habits.length === 0 && !showForm ? (
        <div className="habits-empty">
          <div className="he-icon">🌱</div>
          <div className="he-title">No habits yet</div>
          <div className="he-body">
            Habits are the daily consistency behind every score — drink water, sleep 8 hours,
            walk 8k steps, read 20 pages. Add your first one and rythm tracks streaks,
            completion rate and your weekly heatmap.
          </div>
          <button className="btn-start" onClick={() => setShowForm(true)}>
            ＋ Add your first habit
          </button>
        </div>
      ) : (
        <div className="habit-list">
          {s.habits.map((h) => (
            <HabitCard key={h.id} h={h} today={today} todayDay={todayDay} onOpen={() => setDetailId(h.id)} />
          ))}
        </div>
      )}

      {detailHabit && (
        <HabitDetail h={detailHabit} todayDay={todayDay ?? null} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Habit card
// ---------------------------------------------------------------------------

function HabitCard({ h, today, todayDay, onOpen }: { h: Habit; today: string; todayDay: DailyMetrics | undefined; onOpen: () => void }) {
  const s = useStore();
  const autoOn = s.features.autoHabits; // user may disable biometric auto-completion
  const autoOpts = { auto: autoOn };
  const cur = currentStreak(h, today, todayDay ?? null, autoOpts);
  const longest = longestStreak(h, today, todayDay ?? null, autoOpts);
  const rate = completionRate(h, today, todayDay ?? null, 28, autoOpts);
  const wp = weekProgress(h, today, todayDay ?? null, autoOpts);
  const dueToday = habitDueOn(h, today);
  const auto = autoOn && autoCompleted(h, todayDay ?? null) && h.autoMetric;

  const cells = useMemo(() => {
    const out: { iso: string; done: boolean; due: boolean; value: number | null; isToday: boolean }[] = [];
    for (let i = 13; i >= 0; i--) {
      const iso = addDaysIso(today, -i);
      const due = habitDueOn(h, iso);
      const v = h.logs[iso];
      out.push({
        iso,
        due,
        isToday: iso === today,
        done: due && completedOn(h, iso, today, todayDay ?? null, autoOpts),
        value: v !== undefined ? v : null,
      });
    }
    return out;
  }, [h, today, todayDay, autoOn]);

  return (
    <div className="habit-card-wrap" onClick={onOpen}>
    <Section className="habit-card" key={h.id}>
      <div className="habit-head">
        <span className="habit-icon" style={{ background: `${h.color}1f` }}>{h.icon}</span>
        <div className="habit-id">
          <div className="habit-title">
            {h.title}
            {auto && <span className="auto-badge">auto</span>}
          </div>
          <div className="habit-target">{targetLabel(h)}</div>
        </div>
        <div className="habit-streak" title={`Longest streak ${longest} days`}>
          <span className="flame">🔥</span>
          <span className="streak-num">{cur}</span>
          <span className="streak-unit">day{cur === 1 ? "" : "s"}</span>
        </div>
      </div>

      {/* 14-day grid */}
      <div className="habit-grid">
        {cells.map((c) =>
          c.isToday ? (
            <button
              key={c.iso}
              className={`cell today ${c.done ? "done" : ""} ${!dueToday ? "nodue" : ""}`}
              style={c.done ? { background: h.color } : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (dueToday) s.toggleHabitToday(h.id);
              }}
              title={today}
            >
              {c.done ? "✓" : ""}
            </button>
          ) : (
            <div
              key={c.iso}
              className={`cell ${c.done ? "done" : ""} ${!c.due ? "nodue" : ""}`}
              style={c.done ? { background: h.color } : undefined}
              title={`${c.iso}${c.value !== null ? ` · ${c.value}` : ""}`}
            />
          )
        )}
      </div>

      <div className="habit-foot">
        <div className="week-dots" title={`${wp.done}/${wp.target} this week`}>
          {Array.from({ length: 7 }).map((_, i) => {
            const iso = addDaysIso(today, -(6 - i));
            const done = completedOn(h, iso, today, todayDay ?? null, autoOpts);
            const due = habitDueOn(h, iso);
            return (
              <span key={i} className={`wdot ${due ? "" : "nodue"} ${done ? "done" : ""}`} style={done ? { background: h.color } : undefined} />
            );
          })}
          <span className="week-progress">{wp.done}/{wp.target}</span>
        </div>
        <div className="habit-metrics">
          <span title="Longest streak">🏆 {longest}</span>
          <span title="Completion rate (28d)">{rate}%</span>
        </div>
      </div>
      <div className="habit-open">View detail <span>▸</span></div>
    </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add habit form
// ---------------------------------------------------------------------------

function HabitForm({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("✅");
  const [color, setColor] = useState(COLORS[2]);
  const [targetType, setTargetType] = useState<HabitTargetType>("BOOLEAN");
  const [targetValue, setTargetValue] = useState("1");
  const [unit, setUnit] = useState("");
  const [frequency, setFrequency] = useState<HabitFrequency>("DAILY");
  const [customDays, setCustomDays] = useState<number[]>([1, 3, 5]);
  const [timesPerWeek, setTimesPerWeek] = useState("3");
  const [autoMetric, setAutoMetric] = useState("");
  const [autoOp, setAutoOp] = useState<"gte" | "lte">("gte");

  const submit = () => {
    if (!title.trim()) return;
    const h: Habit = {
      id: uid("hab"),
      title: title.trim(),
      icon,
      color,
      targetType,
      targetValue: targetType === "BOOLEAN" ? 1 : parseFloat(targetValue) || 0,
      unit: targetType === "BOOLEAN" ? "" : unit,
      frequency,
      customDays,
      timesPerWeek: parseInt(timesPerWeek, 10) || 1,
      autoMetric: (autoMetric || null) as Habit["autoMetric"],
      autoOp: autoMetric ? autoOp : null,
      logs: {},
      createdAt: new Date().toISOString(),
    };
    s.addHabit(h);
    onDone();
  };

  return (
    <Section className="habit-form" title="New habit">
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Read 20 pages" autoFocus />
      </label>

      <div className="field-row">
        <div className="field">
          <span>Icon</span>
          <div className="icon-picker">
            {ICONS.map((ic) => (
              <button key={ic} className={`icon-opt ${icon === ic ? "active" : ""}`} onClick={() => setIcon(ic)}>
                {ic}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Color</span>
          <div className="color-picker">
            {COLORS.map((c) => (
              <button key={c} className={`color-opt ${color === c ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span>Metric type</span>
        <div className="seg">
          {(["BOOLEAN", "NUMERIC", "DURATION"] as HabitTargetType[]).map((t) => (
            <button key={t} className={`seg-btn ${targetType === t ? "active" : ""}`} onClick={() => setTargetType(t)}>
              {t === "BOOLEAN" ? "Checkbox" : t === "NUMERIC" ? "Number" : "Duration"}
            </button>
          ))}
        </div>
      </div>

      {targetType !== "BOOLEAN" && (
        <div className="field-row">
          <div className="field">
            <span>Target</span>
            <input
              type="number"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={targetType === "DURATION" ? "minutes" : "value"}
            />
          </div>
          <div className="field">
            <span>Unit</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={targetType === "DURATION" ? "min" : "e.g. ml"} />
          </div>
        </div>
      )}

      <div className="field">
        <span>Frequency</span>
        <div className="seg">
          {(["DAILY", "WEEKDAYS", "CUSTOM"] as HabitFrequency[]).map((f) => (
            <button key={f} className={`seg-btn ${frequency === f ? "active" : ""}`} onClick={() => setFrequency(f)}>
              {f === "DAILY" ? "Daily" : f === "WEEKDAYS" ? "Weekdays" : "Custom"}
            </button>
          ))}
        </div>
      </div>

      {frequency === "CUSTOM" && (
        <div className="field">
          <span>Days & times per week</span>
          <div className="day-picker">
            {WEEKDAY_LABELS.map((l, i) => (
              <button
                key={i}
                className={`day-opt ${customDays.includes(i) ? "active" : ""}`}
                onClick={() => setCustomDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="mini-input"
            min={1}
            max={7}
            value={timesPerWeek}
            onChange={(e) => setTimesPerWeek(e.target.value)}
          />
          <span className="mini-hint">times / week</span>
        </div>
      )}

      <div className="field">
        <span>Auto-complete from biometrics</span>
        <div className="auto-row">
          <select value={autoMetric} onChange={(e) => setAutoMetric(e.target.value)}>
            {AUTO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {autoMetric && (
            <select value={autoOp} onChange={(e) => setAutoOp(e.target.value as "gte" | "lte")}>
              <option value="gte">≥ target</option>
              <option value="lte">≤ target</option>
            </select>
          )}
        </div>
      </div>

      <button className="btn-start" onClick={submit} disabled={!title.trim()}>
        Create habit
      </button>
    </Section>
  );
}
