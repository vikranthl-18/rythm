import { Pill } from "./ui";
import AiInsight from "./AiInsight";
import type { MetricExplainer } from "../engine/aiMetrics";
import type { AiInput, AiMetrics } from "../engine/aiMetrics";
import type { CoachContext } from "../engine/coach";
import type { LearningStatus } from "../engine/aiLearning";
import { AI_LEARNING_DAYS } from "../engine/aiLearning";
import { metricsInsight } from "../engine/aiInsight";
import { useMemo } from "react";

const PILL: Record<MetricExplainer["tone"], "good" | "warn" | "bad" | "accent"> = {
  good: "good",
  warn: "warn",
  bad: "bad",
  accent: "accent",
};

export default function AiMetricsSheet({
  rows,
  ai,
  input,
  ctx,
  learning,
  onClose,
}: {
  rows: MetricExplainer[];
  ai: AiMetrics;
  input: AiInput;
  ctx: CoachContext;
  learning?: LearningStatus;
  onClose: () => void;
}) {
  const spec = useMemo(() => metricsInsight(ai, input, ctx), [ai, input, ctx]);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">🧬</div>
          <h2>AI performance metrics</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {learning && !learning.learned ? (
            <div className="ai-learning">
              <div className="ai-learning-big">🧬</div>
              <h3>Learning your baseline…</h3>
              <p>
                VO₂max, biological age, fitness score and training status are only meaningful
                against <b>your own</b> baselines — so rythm is watching your resting HR, HRV,
                sleep and recovery before estimating anything. Check back in{" "}
                <b>{learning.daysLeft} day{learning.daysLeft === 1 ? "" : "s"}</b>.
              </p>
              <div className="ai-learning-bar">
                <div
                  className="ai-learning-fill"
                  style={{ width: `${(learning.elapsed / AI_LEARNING_DAYS) * 100}%` }}
                />
              </div>
              <div className="ai-learning-meta">
                {learning.elapsed}/{AI_LEARNING_DAYS} days of data collected
              </div>
              <p className="hint">
                No numbers yet — when the window ends, every metric here is computed from your
                real data and explains itself below.
              </p>
            </div>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Computed by rythm's model from your profile (age, sex, weight, height) and live
                biometrics — resting HR, HRV, and your recovery/strain history. Every number
                explains itself below.
              </p>
              <div className="ai-rows">
                {rows.map((r) => (
                  <div key={r.label} className="ai-row">
                    <div className="ai-row-head">
                      <span className="ai-row-label">{r.label}</span>
                      <span className="ai-row-value">
                        {r.value}
                        {r.unit && <span className="ai-row-unit"> {r.unit}</span>}
                      </span>
                      {r.badge && <Pill tone={PILL[r.tone]}>{r.badge}</Pill>}
                    </div>
                    <p className="ai-row-body">{r.body}</p>
                  </div>
                ))}
              </div>
              <p className="hint">For guidance, not medical advice — estimates from wearable data, not lab measurements.</p>
              <AiInsight spec={spec} title="AI review of these metrics" icon="🧠" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
