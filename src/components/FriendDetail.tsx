import { useMemo, useState } from "react";
import type { Friend, Workout } from "../types";
import { activityDef } from "../types";
import { computeRecords } from "../engine/records";
import { handleOf } from "../engine/friends";
import { useStore } from "../store";
import { fmtDuration, fmtKm } from "../lib/geo";
import Avatar from "./Avatar";

function fmtPaceSecPerKm(mps: number): string {
  const s = Math.round(1000 / Math.max(0.1, mps));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}

function FriendStats({ workouts }: { workouts: Workout[] }) {
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  let weekKm = 0;
  let weekSessions = 0;
  let totalKm = 0;
  let totalSec = 0;
  for (const w of workouts) {
    if (new Date(w.startIso).getTime() >= weekAgo) {
      weekKm += w.distanceM / 1000;
      weekSessions++;
    }
    totalKm += w.distanceM / 1000;
    totalSec += w.durationSec;
  }
  return (
    <div className="friend-stats">
      <div className="fs-stat">
        <span className="fs-value">{weekSessions}</span>
        <span className="fs-label">this wk</span>
      </div>
      <div className="fs-stat">
        <span className="fs-value">{weekKm.toFixed(1)} km</span>
        <span className="fs-label">wk volume</span>
      </div>
      <div className="fs-stat">
        <span className="fs-value">{totalKm.toFixed(0)} km</span>
        <span className="fs-label">all time</span>
      </div>
      <div className="fs-stat">
        <span className="fs-value">{fmtDuration(totalSec)}</span>
        <span className="fs-label">total time</span>
      </div>
    </div>
  );
}

function FriendWorkoutRow({ w }: { w: Workout }) {
  const def = activityDef(w.type);
  const [open, setOpen] = useState(false);
  const pace = w.distanceM > 0 ? fmtPaceSecPerKm(w.distanceM / w.durationSec) : null;
  return (
    <div className={`friend-wo ${open ? "open" : ""}`}>
      <button className="fw-head" onClick={() => setOpen((v) => !v)}>
        <span className="fw-icon" style={{ background: `${def.color}1f`, color: def.color }}>
          {def.icon}
        </span>
        <div className="fw-body">
          <div className="fw-title">{w.title}</div>
          <div className="fw-meta">
            {new Date(w.startIso).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
            {fmtDuration(w.durationSec)}
            {w.distanceM > 0 && <> · {fmtKm(w.distanceM)}</>}
            {pace && <> · {pace}</>}
          </div>
        </div>
        <div className="fw-side">
          <span className="fw-strain">strain {w.strain.toFixed(1)}</span>
          <span className="wo-chev">{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && (
        <div className="fw-detail">
          <div className="fw-stats">
            <div>
              <span className="ws-label">Avg HR</span>
              <span className="ws-value">{w.avgHr} bpm</span>
            </div>
            <div>
              <span className="ws-label">Max HR</span>
              <span className="ws-value">{w.maxHr} bpm</span>
            </div>
            <div>
              <span className="ws-label">Elev gain</span>
              <span className="ws-value">{w.elevationGainM} m</span>
            </div>
            <div>
              <span className="ws-label">Splits</span>
              <span className="ws-value">
                {w.splitsSec.length > 0 ? `${w.splitsSec.length} km` : "—"}
              </span>
            </div>
          </div>
          {w.splitsSec.length > 0 && (
            <div className="splits">
              {w.splitsSec.slice(0, 8).map((sp, i) => (
                <div key={i} className="split">
                  <span>km {i + 1}</span>
                  <span>
                    {Math.floor(sp / 60)}:{String(sp % 60).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FriendDetail({
  friend,
  onClose,
}: {
  friend: Friend;
  onClose: () => void;
}) {
  const s = useStore();
  const records = useMemo(() => computeRecords(friend.workouts), [friend.workouts]);
  const prs = records.filter((r) => r.main);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <Avatar name={friend.name} color={friend.color} avatar={friend.avatar} className="sheet-avatar" />
          <div>
            <h2>{friend.name}</h2>
            <div className="sheet-sub">{friend.goal}</div>
            {friend.email && (
              <div className="sheet-sub faint">
                {handleOf(friend.email)}
                {friend.joinedAt
                  ? ` · joined ${new Date(friend.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
                  : ""}
              </div>
            )}
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <FriendStats workouts={friend.workouts} />

          {prs.length > 0 && (
            <div className="hd-section">
              <div className="hd-title">
                Records &amp; PRs <span className="hint-inline">best of all time</span>
              </div>
              <div className="records compact">
                {prs.slice(0, 6).map((r) => (
                  <div key={r.label} className="record-row">
                    <span className="record-icon">{r.icon}</span>
                    <div className="record-label">{r.label}</div>
                    <div className="record-main">{r.main}</div>
                    <div className="record-side">
                      {r.sub && <div className="record-sub">{r.sub}</div>}
                      {r.detail && <div className="record-detail">{r.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="hd-section">
            <div className="hd-title">
              Recent activity <span className="hint-inline">{friend.workouts.length} logged</span>
            </div>
            {friend.workouts.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>
                No workouts shared yet — as they log sessions with Cloud sync on, they&apos;ll appear here.
              </p>
            ) : (
              <div className="friend-feed">
                {friend.workouts.map((w) => (
                  <FriendWorkoutRow key={w.id} w={w} />
                ))}
              </div>
            )}
          </div>

          <button
            className="btn-ghost btn-danger"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              s.removeFriend(friend.id);
              onClose();
            }}
          >
            Remove friend
          </button>
        </div>
      </div>
    </div>
  );
}
