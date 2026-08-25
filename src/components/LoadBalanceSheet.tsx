import { useMemo } from "react";
import { Pill } from "./ui";
import AiInsight from "./AiInsight";
import type { LoadBalance, SessionRecommendation } from "../engine/load";
import type { UserBaseline } from "../engine/baselines";
import type { CoachContext } from "../engine/coach";
import { loadInsight } from "../engine/aiInsight";

const STATUS_TONE: Record<LoadBalance["status"], "good" | "warn" | "bad" | "accent"> = {
  Underloading: "warn",
  Balanced: "good",
  Spiking: "warn",
  Overloading: "bad",
};

export default function LoadBalanceSheet({
  load,
  recovery,
  rec,
  recoveryBaseline,
  ctx,
  onClose,
}: {
  load: LoadBalance;
  recovery: number;
  rec: SessionRecommendation;
  recoveryBaseline: UserBaseline;
  ctx: CoachContext;
  onClose: () => void;
}) {
  const acwrPct = Math.min(100, (load.acwr / 2) * 100);
  const spec = useMemo(() => loadInsight(load, recovery, rec, ctx), [load, recovery, rec, ctx]);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">⚖️</div>
          <h2>Training load &amp; fitness balance</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="lb-hero">
            <div>
              <div className="lb-label">Current load (7-day avg)</div>
              <div className="lb-big">{load.acute.toFixed(1)}</div>
            </div>
            <div>
              <div className="lb-label">Fitness baseline (28-day avg)</div>
              <div className="lb-big">{load.chronic.toFixed(1)}</div>
            </div>
            <div>
              <div className="lb-label">Ratio</div>
              <div className="lb-big">{load.acwr.toFixed(2)}<span className="lb-unit">×</span></div>
            </div>
          </div>

          <div className="lb-acwr">
            <div className="lb-scale">
              <span>0.5</span>
              <span>0.8</span>
              <span>1.3</span>
              <span>1.5</span>
              <span>2.0</span>
            </div>
            <div className="lb-track">
              <div className="lb-zone" style={{ left: "0%", width: "30%" }} />
              <div className="lb-zone ok" style={{ left: "30%", width: "35%" }} />
              <div className="lb-zone warn" style={{ left: "65%", width: "10%" }} />
              <div className="lb-zone bad" style={{ left: "75%", width: "25%" }} />
              <div className="lb-marker" style={{ left: `${acwrPct}%` }} />
            </div>
            <div className="lb-status">
              <Pill tone={STATUS_TONE[load.status]}>{load.status}</Pill>
              <span className="hint-inline">
                {load.learned
                  ? `from your last ${load.chronicDays} days of strain`
                  : `still learning — ${load.chronicDays} days of history so far`}
              </span>
            </div>
          </div>

          <div className="lb-rec" style={{ borderColor: "var(--accent-30)" }}>
            <div className="lb-rec-title">{rec.title}</div>
            <p className="lb-rec-body">{rec.body}</p>
          </div>

          <div className="lb-notes">
            <p className="hint" style={{ marginTop: 0 }}>
              <b>Acute load</b> (last 7 days) is what your body is doing now; <b>chronic load</b>{" "}
              (last 28 days) is what it's adapted to. The ratio is the classic fitness–fatigue
              balance: 0.8–1.3 is the safe building zone, above 1.5 is where injuries spike.
            </p>
            <p className="hint">
              <b>Recovery today is {recovery}%</b> ({recoveryBaseline.learned ? `vs your 7-day baseline of ${recoveryBaseline.value.toFixed(0)}` : "baseline still learning"}). Low recovery plus a rising ratio is the signal to back off; high recovery plus a low ratio is the signal to build.
            </p>
          </div>
          <AiInsight spec={spec} title="AI read on your load balance" icon="⚖️" />
        </div>
      </div>
    </div>
  );
}
