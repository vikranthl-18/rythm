import { useState } from "react";
import { buildRythmReport, reportShareText } from "../engine/rhythmReport";
import { useStore } from "../store";

const fmtPace = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export default function RythmReportSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [copied, setCopied] = useState(false);
  const report = buildRythmReport(s.days, s.workouts, s.profile.goal);
  const trendColor = (score: number) => (score >= 67 ? "var(--green)" : score >= 34 ? "var(--yellow)" : "var(--red)");
  const avgTone = report.avgScore >= 67 ? "good" : report.avgScore >= 34 ? "warn" : "bad";

  const share = async () => {
    const text = reportShareText(report);
    const nav = navigator as Navigator & { share?: (d: { title?: string; text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "My rythm report", text });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">📊</div>
          <h2>Your Rythm Report</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="report-card">
            <div className="report-top">
              <span className="report-brand">💠 rythm report</span>
              <span className="report-window">last {report.windowDays} days</span>
            </div>
            <div className="report-score-row">
              <div>
                <div className="report-score-label">Score trend</div>
                <div className={`report-score ${avgTone}`}>{report.avgScore}<span className="report-score-max">/100</span></div>
              </div>
              <div className="report-avatar">{(s.auth?.name ?? s.profile.name).charAt(0).toUpperCase()}</div>
            </div>
            <div className="report-trend">
              {report.trend.map((t) => (
                <div key={t.date} className="report-trend-col" title={`${t.date}: ${t.score}`}>
                  <div className="report-trend-bar" style={{ height: `${Math.max(4, t.score)}%`, background: trendColor(t.score) }} />
                </div>
              ))}
            </div>
            {report.goal && <div className="report-goal">🏅 Training for: {report.goal}</div>}
            <div className="report-stats">
              <div className="report-stat"><span className="report-stat-num">{report.sessions}</span><span className="report-stat-lab">sessions</span></div>
              <div className="report-stat"><span className="report-stat-num">{report.totalKm}</span><span className="report-stat-lab">km total</span></div>
              <div className="report-stat"><span className="report-stat-num">{report.bestWeekKm}</span><span className="report-stat-lab">best week km</span></div>
              <div className="report-stat"><span className="report-stat-num">{report.longestRunKm}</span><span className="report-stat-lab">longest run km</span></div>
            </div>
          </div>

          <div className="hd-title" style={{ marginTop: 12 }}>Personal records</div>
          <div className="report-prs">
            {report.prs.map((p) => (
              <div key={p.label} className="report-pr">
                <span className="report-pr-label">{p.label}</span>
                {p.paceSecPerKm ? (
                  <span className="report-pr-pace">{fmtPace(p.paceSecPerKm)}/km</span>
                ) : (
                  <span className="report-pr-pace dim">—</span>
                )}
              </div>
            ))}
          </div>

          <div className="hd-title" style={{ marginTop: 12 }}>Sleep story</div>
          {report.sleep.nights ? (
            <p className="hint" style={{ marginTop: 4 }}>
              You averaged <b>{Math.round((report.sleep.avgMin / 60) * 10) / 10}h</b> a night (need ≈{" "}
              {Math.round(report.sleep.needMin / 60)}h) with <b>{report.sleep.goodNights}</b> of{" "}
              {report.sleep.nights} nights scoring green. Cumulative sleep debt over the window:{" "}
              <b>{Math.round(report.sleep.debtMin / 60)}h</b>.
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 4 }}>
              Wear a device overnight to build your sleep story.
            </p>
          )}

          <button className="btn-start" style={{ marginTop: 12 }} onClick={() => void share()}>
            {copied ? "Copied ✓" : "📤 Share this report"}
          </button>
          <p className="hint" style={{ marginTop: 6 }}>
            Opens your phone&apos;s share sheet; falls back to copying the summary.
          </p>
        </div>
      </div>
    </div>
  );
}
