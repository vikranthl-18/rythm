import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { recoveryColor } from "../engine/recovery";
import { QUICK_PROMPTS, coachMode } from "../engine/coach";
import { computeDataInsights } from "../engine/correlations";
import { Ring } from "../components/ui";

const COLOR_HEX: Record<"green" | "yellow" | "red", string> = {
  green: "#73976a",
  yellow: "#c98a2d",
  red: "#a63c3c",
};

export default function Coach() {
  const s = useStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const today = s.days[s.days.length - 1];
  const color = recoveryColor(today.recovery);
  const hex = COLOR_HEX[color];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.messages, s.coachTyping]);

  const dataInsights = useMemo(() => computeDataInsights(s.days, s.workouts), [s.days, s.workouts]);

  const habitsToday = useMemo(() => {
    let done = 0;
    let due = 0;
    for (const h of s.habits) {
      const dueToday = (h.frequency === "DAILY") || (h.frequency === "WEEKDAYS" && [1, 2, 3, 4, 5].includes(new Date().getDay())) || (h.frequency === "CUSTOM" && h.customDays.includes(new Date().getDay()));
      if (!dueToday) continue;
      due++;
      const log = h.logs[today.date];
      const completed = log !== undefined
        ? (h.targetType === "BOOLEAN" ? log >= 1 : log >= h.targetValue)
        : h.autoMetric
          ? (h.autoMetric === "sleepDuration" ? (h.autoOp === "lte" ? today.sleep.durationMin <= h.targetValue : today.sleep.durationMin >= h.targetValue)
            : h.autoMetric === "steps" ? (h.autoOp === "lte" ? today.steps <= h.targetValue : today.steps >= h.targetValue)
            : false)
          : false;
      if (completed) done++;
    }
    return { done, due };
  }, [s.habits, today]);

  const send = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    s.sendMessage(t);
  };

  return (
    <div className="page coach-page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">Coach</span>
        </div>
        <div className="top-right">
          <span className="chip" title={coachMode() === "ai" ? "Replies come from a real LLM via your serverless function" : "No model endpoint configured — replies come from the on-device engine"}>
            {coachMode() === "ai" ? "✨ AI-powered" : "on-device engine"}
          </span>
          <span className="chip">goal: {s.profile.goal}</span>
        </div>
      </header>

      {/* What your data says — deterministic cross-correlations the coach
          noticed (evening training vs sleep, strain vs sleep, sleep vs RHR). */}
      {dataInsights.length > 0 && (
        <div className="insights">
          <div className="insights-head">
            <span>What your data says</span>
            <span className="hint-inline">found automatically</span>
          </div>
          {dataInsights.map((ins) => (
            <div key={ins.title} className="insight">
              <span className="insight-icon">{ins.icon}</span>
              <div className="insight-body">
                <div className="insight-title">{ins.title}</div>
                <p className="insight-text">{ins.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* context strip */}
      <div className="ctx-strip">
        <div className="ctx-item">
          <Ring size={54} stroke={5} pct={today.recovery / 100} color={hex}>
            <span className="ctx-num" style={{ color: hex }}>{today.recovery}</span>
          </Ring>
          <span className="ctx-label">recovery</span>
        </div>
        <div className="ctx-item">
          <span className="ctx-big">{s.strain.toFixed(1)}</span>
          <span className="ctx-label">strain now</span>
        </div>
        <div className="ctx-item">
          <span className="ctx-big">{today.sleep.score}</span>
          <span className="ctx-label">sleep</span>
        </div>
        <div className="ctx-item">
          <span className="ctx-big">{habitsToday.done}/{habitsToday.due}</span>
          <span className="ctx-label">habits</span>
        </div>
        <div className="ctx-item">
          <span className="ctx-big">{today.hrv}</span>
          <span className="ctx-label">hrv ms</span>
        </div>
      </div>

      <div className="chat">
        {s.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === "coach" && <span className="bubble-avatar">◢</span>}
            <div className="bubble-body">
              <p className="bubble-text">{m.text}</p>
              <span className="bubble-time">{m.time}</span>
            </div>
          </div>
        ))}
        {s.coachTyping && (
          <div className="bubble coach">
            <span className="bubble-avatar">◢</span>
            <div className="bubble-body">
              <p className="bubble-text typing-dots" aria-label="Coach is typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="quick-prompts">
        {QUICK_PROMPTS.map((q) => (
          <button key={q} className="qp" onClick={() => s.sendMessage(q)}>{q}</button>
        ))}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about recovery, training, sleep, nutrition…"
        />
        <button className="send-btn" onClick={send} disabled={!input.trim()}>➤</button>
      </div>
    </div>
  );
}
