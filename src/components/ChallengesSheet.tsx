import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  CHALLENGE_ICONS,
  CHALLENGE_METRIC_META,
  buildChallengeProgress,
  challengeIsActive,
  type ChallengeMetric,
} from "../engine/challenges";
import Avatar from "./Avatar";

export default function ChallengesSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const me = s.auth?.email ?? "alex.rivera@gmail.com";
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🥇");
  const [metric, setMetric] = useState<ChallengeMetric>("distanceKm");
  const [target, setTarget] = useState("50");
  const [days, setDays] = useState("7");
  const [invites, setInvites] = useState<Set<string>>(new Set());

  const progress = useMemo(
    () => s.challenges.map((c) => buildChallengeProgress(c, me, s.workouts, s.friends)),
    [s.challenges, me, s.workouts, s.friends]
  );
  const today = s.days[s.days.length - 1]?.date ?? new Date().toISOString().slice(0, 10);

  const create = () => {
    const t = parseFloat(target);
    const d = parseInt(days, 10);
    if (!title.trim()) return;
    if (Number.isNaN(t) || t <= 0) return;
    if (Number.isNaN(d) || d < 1 || d > 90) return;
    s.createChallenge({
      title,
      icon,
      metric,
      target: t,
      days: d,
      memberEmails: [...invites],
    });
    setCreating(false);
    setTitle("");
    setInvites(new Set());
  };

  const meta = CHALLENGE_METRIC_META[metric];
  const fmtVal = (p: { value: number; pct: number }, c: { metric: ChallengeMetric }) =>
    c.metric === "distanceKm" ? `${p.value} km` : c.metric === "strain" ? `${p.value}` : `${p.value}`;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">🥇</div>
          <h2>Group challenges</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {progress.length === 0 && !creating && (
            <div className="challenges-empty">
              <p className="hint" style={{ marginTop: 0, textAlign: "center" }}>
                No challenges yet. Set a goal with friends — e.g. <b>50 km together this week</b> —
                and everyone&apos;s workouts count toward the same target.
              </p>
            </div>
          )}

          {progress.map((p) => {
            const c = p.challenge;
            const m = CHALLENGE_METRIC_META[c.metric];
            const isActive = challengeIsActive(c, today);
            return (
              <div key={c.id} className={`challenge-card ${isActive ? "" : "ended"}`}>
                <div className="challenge-head">
                  <span className="challenge-icon">{c.icon}</span>
                  <div className="challenge-info">
                    <div className="challenge-title">{c.title}</div>
                    <div className="challenge-meta">
                      {m.icon} {m.label} · target {c.target} {m.unit} · {c.startIso} → {p.endIso}
                      {!isActive && <span className="hint-inline"> · ended</span>}
                    </div>
                  </div>
                  {c.createdBy === me && (
                    <button className="link-btn danger" onClick={() => s.deleteChallenge(c.id)}>
                      delete
                    </button>
                  )}
                </div>
                <div className="challenge-members">
                  {p.members.map((mem) => (
                    <div key={mem.email} className={`challenge-member ${mem.isMe ? "me" : ""}`}>
                      <Avatar name={mem.name} color={mem.color} avatar={mem.avatar ?? null} className="challenge-avatar" />
                      <div className="challenge-member-body">
                        <div className="challenge-member-top">
                          <span className="challenge-member-name">{mem.name}{mem.isMe ? " (you)" : ""}</span>
                          <span className="challenge-member-val">
                            {fmtVal(mem, c)} / {c.target} {m.unit}
                          </span>
                        </div>
                        <div className="challenge-bar">
                          <div className="challenge-bar-fill" style={{ width: `${mem.pct}%`, background: mem.color }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {creating ? (
            <div className="challenge-create">
              <div className="field" style={{ marginBottom: 10 }}>
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 50 km club week" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <span>Icon</span>
                <div className="seg">
                  {CHALLENGE_ICONS.map((ic) => (
                    <button key={ic} className={`seg-btn ${icon === ic ? "active" : ""}`} onClick={() => setIcon(ic)}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <span>Metric</span>
                <div className="seg">
                  {(Object.keys(CHALLENGE_METRIC_META) as ChallengeMetric[]).map((k) => (
                    <button key={k} className={`seg-btn ${metric === k ? "active" : ""}`} onClick={() => setMetric(k)}>
                      {CHALLENGE_METRIC_META[k].icon} {CHALLENGE_METRIC_META[k].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Target ({meta.unit || "count"})</span>
                  <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
                </label>
                <label className="field">
                  <span>Days</span>
                  <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
                </label>
              </div>
              {s.friends.length > 0 ? (
                <div className="field" style={{ marginBottom: 10 }}>
                  <span>Invite friends</span>
                  <div className="invite-list">
                    {s.friends.map((f) => {
                      const checked = invites.has(f.email);
                      return (
                        <button
                          key={f.id}
                          className={`invite-row ${checked ? "on" : ""}`}
                          onClick={() => {
                            const next = new Set(invites);
                            if (checked) next.delete(f.email);
                            else next.add(f.email);
                            setInvites(next);
                          }}
                        >
                          <Avatar name={f.name} color={f.color} avatar={f.avatar ?? null} className="invite-avatar" />
                          <span className="invite-name">{f.name}</span>
                          <span className="invite-check">{checked ? "✓" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="hint">Add friends first (Activity → Friends) — their workouts count toward the challenge.</p>
              )}
              <div className="btn-row">
                <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                <button className="btn-start" disabled={!title.trim()} onClick={create}>Start challenge</button>
              </div>
            </div>
          ) : (
            <button className="btn-start" style={{ marginTop: 8 }} onClick={() => setCreating(true)}>
              ＋ New challenge
            </button>
          )}
          <p className="hint" style={{ marginTop: 8 }}>
            Local-first for now: challenges live on this device (not yet synced to the cloud).
            Friend progress comes from their synced workouts.
          </p>
        </div>
      </div>
    </div>
  );
}
