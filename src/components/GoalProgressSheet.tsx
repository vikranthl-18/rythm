import type { GoalProgress } from "../engine/goals";

export default function GoalProgressSheet({
  progress,
  onClose,
}: {
  progress: GoalProgress;
  onClose: () => void;
}) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">{progress.goal.icon}</div>
          <h2>{progress.goal.label}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="gp-target">{progress.goal.targetText}</p>
          <div className="gp-hero">
            <div className="gp-pct">{progress.pct}%</div>
            <div className="gp-headline">{progress.headline}</div>
          </div>
          <div className="progress" style={{ margin: "10px 0 4px" }}>
            <div className="progress-fill" style={{ width: `${progress.pct}%`, background: "var(--green)" }} />
          </div>
          <p className="gp-current">{progress.current}</p>

          <div className="gp-list">
            <div className="gp-list-title">✅ Done</div>
            {progress.done.map((d) => (
              <div key={d} className="gp-item done">
                <span className="gp-check">✓</span>
                {d}
              </div>
            ))}
          </div>

          <div className="gp-list">
            <div className="gp-list-title">🎯 Next steps</div>
            {progress.todo.map((t, i) => (
              <div key={t} className="gp-item">
                <span className="gp-num">{i + 1}</span>
                {t}
              </div>
            ))}
          </div>

          <p className="hint">Progress is computed from your real workout history — routes, paces and volume.</p>
        </div>
      </div>
    </div>
  );
}
