import { Pill } from "./ui";
import type { GhostResult, Workout } from "../types";
import { activityDef } from "../types";
import type { WorkoutInsight } from "../engine/workoutInsight";
import { fmtDuration, fmtKm } from "../lib/geo";

export default function PostWorkoutSheet({
  workout,
  insight,
  ghost,
  onClose,
}: {
  workout: Workout;
  insight: WorkoutInsight;
  ghost?: GhostResult | null;
  onClose: () => void;
}) {
  const def = activityDef(workout.type);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">{def.icon}</div>
          <h2>Workout complete</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="pw-stats">
            <div>
              <span className="pw-label">Time</span>
              <span className="pw-value">{fmtDuration(workout.durationSec)}</span>
            </div>
            {workout.distanceM > 0 && (
              <div>
                <span className="pw-label">Distance</span>
                <span className="pw-value">{fmtKm(workout.distanceM)}</span>
              </div>
            )}
            <div>
              <span className="pw-label">Strain</span>
              <span className="pw-value">{workout.strain.toFixed(1)}</span>
            </div>
            <div>
              <span className="pw-label">Avg HR</span>
              <span className="pw-value">{workout.avgHr > 0 ? `${workout.avgHr} bpm` : "—"}</span>
            </div>
          </div>

          <div className="pw-section">
            <div className="pw-title">💪 What you did well</div>
            {insight.good.map((g) => (
              <div key={g} className="pw-item">
                <span className="pw-bullet">•</span>
                {g}
              </div>
            ))}
          </div>

          {insight.goalNote && (
            <div className="pw-section">
              <div className="pw-title">
                🎯 Goal check{" "}
                {insight.goalProgress && <Pill tone="accent">{insight.goalProgress.goal.label}</Pill>}
              </div>
              <p className="pw-note">{insight.goalNote}</p>
              {insight.goalProgress && (
                <div className="progress" style={{ marginTop: 8 }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${insight.goalProgress.pct}%`, background: "var(--green)" }}
                  />
                </div>
              )}
            </div>
          )}

          {ghost && (
            <div className="pw-section">
              <div className="pw-title">👻 Ghost race</div>
              <p
                className="pw-note"
                style={{ color: ghost.won ? "var(--green)" : "var(--red)" }}
              >
                {ghost.won
                  ? `You beat ${ghost.friendName} by ${ghost.deltaSec}s over the full course — the route is yours.`
                  : ghost.completed
                    ? `${ghost.friendName} beat you by ${Math.abs(ghost.deltaSec)}s. Revenge is scheduled.`
                    : `You stopped before the full course — ${ghost.friendName}'s ghost wins by default (you were ${Math.abs(ghost.deltaSec)}s behind over what you ran).`}
              </p>
            </div>
          )}

          <div className="pw-section">
            <div className="pw-title">🌙 Tomorrow</div>
            <p className="pw-note">{insight.tomorrow}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
