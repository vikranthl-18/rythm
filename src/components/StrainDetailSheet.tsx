import { Bars, Pill, Section } from "./ui";
import type { DailyMetrics } from "../types";
import type { LoadBalance, SessionRecommendation } from "../engine/load";
import { ZONE_WEIGHTS } from "../engine/zones";

function strainTone(strain: number, target: number): "good" | "warn" | "bad" {
  if (strain >= target) return "bad";
  if (strain >= target * 0.8) return "warn";
  return "good";
}

export default function StrainDetailSheet({
  strain,
  target,
  recovery,
  load,
  rec,
  history,
  onClose,
}: {
  strain: number;
  target: number;
  recovery: number;
  load: LoadBalance;
  rec: SessionRecommendation;
  history: DailyMetrics[];
  onClose: () => void;
}) {
  const tone = strainTone(strain, target);
  const color = tone === "good" ? "var(--green)" : tone === "warn" ? "var(--yellow)" : "var(--red)";
  const remaining = Math.max(0, target - strain);
  const pctOfTarget = Math.min(100, (strain / Math.max(0.1, target)) * 100);
  const week = history.slice(-7);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">⚡</div>
          <h2>Day Strain</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="rs-hero">
            <div className="rs-big" style={{ color }}>
              {strain.toFixed(1)}
              <span className="rs-big-total">/ 21</span>
            </div>
            <div className="rs-side">
              <Pill tone={tone}>
                {tone === "good" ? "on track" : tone === "warn" ? "near target" : "at / over target"}
              </Pill>
              <p className="rs-tagline">
                Strain measures how hard your body is working today — time in each heart-rate
                zone, accumulated all day, on a 0–21 scale.
              </p>
            </div>
          </div>

          <div className="sd-budget">
            <div className="sd-budget-head">
              <span>
                {strain.toFixed(1)} of {target.toFixed(1)} target
                <span className="hint-inline"> · recovery {recovery}%</span>
              </span>
              <span style={{ color }}>
                {remaining > 0 ? `${remaining.toFixed(1)} left in the budget` : "budget spent"}
              </span>
            </div>
            <div className="progress" style={{ margin: "6px 0 10px" }}>
              <div className="progress-fill" style={{ width: `${pctOfTarget}%`, background: color }} />
            </div>
            <p className="sd-verdict">
              {tone === "bad"
                ? `You've hit your ${target.toFixed(1)} target. Strain is deliberately hard to earn at the top — further hard work adds little fitness and lots of fatigue. Ease off and protect tomorrow's recovery.`
                : tone === "warn"
                  ? `You're most of the way to your ${target.toFixed(1)} target. Push a little more if you feel great, but the high-value work is done.`
                  : `You have ${remaining.toFixed(1)} strain left before your ${target.toFixed(1)} target — the target scales with your recovery (${recovery}%), so today is a ${recovery >= 67 ? "push" : recovery >= 34 ? "maintain" : "rest"} day.`}
            </p>
          </div>

          <Section title="Strain this week">
            <Bars
              data={week.map((d) => ({ label: d.date.slice(8), value: d.strain }))}
              color="#bd4444"
              height={56}
            />
            <p className="hint" style={{ marginTop: 8 }}>
              Strain is logarithmic — the first minutes of a workout earn more than the last.
              That's why a 45-min tempo can read ~14 while a full day of walking reads ~4.
            </p>
          </Section>

          <Section title="How it's calculated">
            <p className="hint" style={{ marginTop: 0 }}>
              Every minute is weighted by heart-rate zone (HRmax = 220 − age), then mapped through
              a saturating curve:{" "}
              <b>
                strain(W) = 21 · (1 − e<sup>−W/42</sup>)
              </b>
              .
            </p>
            <div className="sd-zones">
              {ZONE_WEIGHTS.map((w, i) => (
                <div key={i} className="sd-zone">
                  <span className="sd-zone-label">Z{i + 1}</span>
                  <span className="sd-zone-weight">×{w}</span>
                  <span className="sd-zone-bar">
                    <i style={{ width: `${(w / 4.5) * 100}%`, background: "var(--accent)" }} />
                  </span>
                </div>
              ))}
            </div>
            <p className="hint">
              A minute in Z4 earns <b>3×</b> the strain of Z2, and Z5 more still — hard efforts
              dominate the number, exactly like a training-load score should.
            </p>
          </Section>

          <Section title="Load balance">
            <div className="week-grid" style={{ marginBottom: 8 }}>
              <div className="week-stat">
                <span className="week-num">{load.acute.toFixed(1)}</span>
                <span className="week-label">acute · 7d</span>
              </div>
              <div className="week-stat">
                <span className="week-num">{load.chronic.toFixed(1)}</span>
                <span className="week-label">chronic · 28d</span>
              </div>
              <div className="week-stat">
                <span className="week-num" style={{ color: load.acwr >= 0.8 && load.acwr <= 1.3 ? "var(--green)" : "var(--yellow)" }}>
                  {load.acwr.toFixed(2)}
                </span>
                <span className="week-label">{load.status}</span>
              </div>
            </div>
            <p className="hint">
              Acute (last 7 days) vs chronic (last 28) strain — a ratio near 1.0 means you're
              building fitness without piling on fatigue.
            </p>
          </Section>

          <Section title="Session recommendation">
            <div className="rec-block">
              <Pill tone={rec.tone}>{rec.title}</Pill>
              <p>{rec.body}</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
