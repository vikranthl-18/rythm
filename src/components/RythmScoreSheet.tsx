import { useMemo } from "react";
import { Pill } from "./ui";
import AiInsight from "./AiInsight";
import type { RythmScore } from "../engine/rhythm";
import type { CoachContext } from "../engine/coach";
import { rhythmInsight } from "../engine/aiInsight";

export default function RythmScoreSheet({
  rythm,
  ctx,
  onClose,
}: {
  rythm: RythmScore;
  ctx: CoachContext;
  onClose: () => void;
}) {
  const spec = useMemo(() => rhythmInsight(rythm, ctx), [rythm, ctx]);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">💠</div>
          <h2>Rythm Score</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="rs-hero">
            <div className="rs-big" style={{ color: rythm.color === "green" ? "var(--green)" : rythm.color === "yellow" ? "var(--yellow)" : "var(--red)" }}>
              {rythm.score}
            </div>
            <div className="rs-side">
              <Pill tone={rythm.color === "green" ? "good" : rythm.color === "yellow" ? "warn" : "bad"}>{rythm.color}</Pill>
              <p className="rs-tagline">
                Your signature metric — six pillars of training, recovery and life, weighted into one number.
              </p>
            </div>
          </div>

          <div className="rs-parts">
            {rythm.parts.map((p) => (
              <div key={p.key} className="rs-part">
                <div className="rs-part-head">
                  <span className="rs-part-icon">{p.icon}</span>
                  <span className="rs-part-label">
                    {p.label} <span className="rs-part-weight">· {Math.round(p.weight * 100)}%</span>
                  </span>
                  <span className="rs-part-score">{p.score}</span>
                </div>
                <div className="progress" style={{ margin: "4px 0 8px" }}>
                  <div
                    className="progress-fill"
                    style={{
                      width: `${p.score}%`,
                      background:
                        p.score >= 67 ? "var(--green)" : p.score >= 34 ? "var(--yellow)" : "var(--red)",
                    }}
                  />
                </div>
                <p className="rs-reason">{p.reason}</p>
                <p className="rs-improve">
                  <b>To improve:</b> {p.improve}
                </p>
              </div>
            ))}
          </div>

          <p className="hint">
            The Rythm Score is a weighted blend — no single pillar dominates, so one bad night
            can't sink a good week. Improve the lowest pillar first; it's the fastest way to raise
            the total.
          </p>
          <AiInsight spec={spec} title="Why this score &amp; how to raise it" icon="💠" />
        </div>
      </div>
    </div>
  );
}
