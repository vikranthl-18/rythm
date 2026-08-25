import { useMemo } from "react";
import { Pill } from "./ui";
import AiInsight from "./AiInsight";
import type { Readiness } from "../engine/readiness";
import type { CoachContext } from "../engine/coach";
import { readinessInsight } from "../engine/aiInsight";

export default function ReadinessSheet({
  readiness,
  ctx,
  onClose,
}: {
  readiness: Readiness;
  ctx: CoachContext;
  onClose: () => void;
}) {
  const spec = useMemo(() => readinessInsight(readiness, ctx), [readiness, ctx]);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">🎯</div>
          <h2>Readiness</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="rs-hero">
            <div
              className="rs-big"
              style={{ color: readiness.score >= 70 ? "var(--green)" : readiness.score >= 40 ? "var(--yellow)" : "var(--red)" }}
            >
              {readiness.score}
            </div>
            <div className="rs-side">
              <Pill tone={readiness.status === "Ready" ? "good" : readiness.status === "Moderate" ? "warn" : "bad"}>
                {readiness.status}
              </Pill>
              <p className="rs-tagline">How ready you are to train right now — recovery, sleep and freshness combined.</p>
            </div>
          </div>

          <p className="rd-verdict">{readiness.verdict}</p>

          <div className="rd-parts">
            {readiness.parts.map((p) => (
              <div key={p.label} className="rd-part">
                <div className="rd-part-head">
                  <span>{p.label}</span>
                  <span className="rd-part-pct">{(p.weight * 100).toFixed(0)}%</span>
                  <span className="rd-part-score">{Math.round(p.score)}</span>
                </div>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{ width: `${p.score}%`, background: "var(--green)" }}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="hint">
            Readiness weights <b>recovery 55%</b> (how your nervous system is rebounding),{" "}
            <b>sleep 30%</b> (the physical repair) and <b>freshness 15%</b> (how much of today's
            strain budget you've already spent).
          </p>
          <AiInsight spec={spec} title="AI verdict on today's readiness" icon="🎯" />
        </div>
      </div>
    </div>
  );
}
