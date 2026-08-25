import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { useStore } from "../store";
import {
  ACTIVITY_TYPES,
  type ActivityType,
  type Friend,
  type FriendRequest,
  type HRZoneMinutes,
  type RecordingState,
  type RoutePoint,
  type Workout,
  activityDef,
} from "../types";
import FriendDetail from "../components/FriendDetail";
import Avatar from "../components/Avatar";
import type { DirectoryUser } from "../data/seed";
import { directoryFor, findByPhone, handleOf } from "../engine/friends";
import { contactsSupported, matchContactsToDirectory, pickContacts } from "../lib/contacts";
import {
  cloudFriendsAvailable,
  lookupPhonesCloud,
  searchUsersCloud,
  type CloudPerson,
} from "../lib/supabaseFriends";
import PostWorkoutSheet from "../components/PostWorkoutSheet";
import { ZONE_COLORS, hrMax, zoneFor } from "../engine/zones";
import { computeRecords } from "../engine/records";
import { computeLoadBalance } from "../engine/load";
import { workoutInsight } from "../engine/workoutInsight";
import { evaluateCue, speak, stopSpeaking } from "../engine/audioCoach";
import { distanceAtTime, fmtDuration, fmtKm, fmtMmSs, haversineM, pacePerKm, routeDistanceM } from "../lib/geo";
import { fallbackAttribution, fallbackTileUrl, tileAttribution, tileUrl } from "../lib/mapTiles";
import { addDaysIso } from "../lib/rng";
import { clamp01, Section } from "../components/ui";

// ---------------------------------------------------------------------------
// Ghost race — pick a friend's GPS workout and race it live
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GPS permission status under the record button
// ---------------------------------------------------------------------------

function GpsStatus() {
  const s = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  if (s.gpsPermission === "granted") {
    return (
      <p className="hint">
        {s.gpsPos
          ? "Live GPS · distance, pace, splits, elevation & HR zones"
          : "Waiting for a GPS fix… your route switches to real GPS the moment it locks"}
      </p>
    );
  }
  if (s.gpsPermission === "denied") {
    return (
      <div className="gps-warn">
        <p className="hint">
          GPS is off — routes will be simulated. Allow location to record real routes.
        </p>
        <button
          className="chip-btn sm"
          onClick={async () => {
            const r = await s.requestGpsPermission();
            setMsg(
              r.blocked
                ? "Blocked by the browser — allow Location in this site's settings (padlock icon), then try again."
                : r.ok
                  ? null
                  : "Still off — you can record with simulated GPS for now."
            );
          }}
        >
          Enable GPS
        </button>
        {msg && <p className="hint">{msg}</p>}
      </div>
    );
  }
  return (
    <p className="hint">
      Simulated GPS · distance, pace, splits, elevation &amp; HR zones. Allow location to use your
      real route.
    </p>
  );
}

function GhostRaceSection() {
  const s = useStore();
  const candidates = useMemo(() => {
    const list: { friend: Friend; workout: Workout }[] = [];
    for (const f of s.friends) {
      for (const w of f.workouts) {
        if ((w.type === "run" || w.type === "trail" || w.type === "cycle") && w.route.length >= 2) {
          list.push({ friend: f, workout: w });
        }
      }
    }
    return list;
  }, [s.friends]);
  const [pick, setPick] = useState(0);
  if (candidates.length === 0) return null;
  const cur = candidates[pick % candidates.length];
  return (
    <Section title="Ghost race">
      <p className="hint" style={{ marginTop: 0 }}>
        Race a friend&apos;s GPS workout live — their route shows as a dashed ghost and rythm calls
        out the gap.
      </p>
      <div className="ghost-pick">
        <button className="ghost-arrow" onClick={() => setPick((p) => (p + candidates.length - 1) % candidates.length)} aria-label="Previous">
          ‹
        </button>
        <div className="ghost-pick-body">
          <span className="ghost-pick-name">{cur.friend.name}</span>
          <span className="ghost-pick-wo">
            {cur.workout.title} · {fmtDuration(cur.workout.durationSec)}
            {cur.workout.distanceM > 0 && <> · {fmtKm(cur.workout.distanceM)}</>}
          </span>
        </div>
        <button className="ghost-arrow" onClick={() => setPick((p) => (p + 1) % candidates.length)} aria-label="Next">
          ›
        </button>
      </div>
      <button
        className="btn-start"
        onClick={() => s.startGhostRace(cur.friend, cur.workout)}
      >
        👻 Race {cur.friend.name.split(" ")[0]}&apos;s{" "}
        {activityDef(cur.workout.type).label.toLowerCase()}
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Map with optional per-segment (pace) coloring
// ---------------------------------------------------------------------------

function MapView({
  points,
  center,
  height = 230,
  live = false,
  colors,
  ghost,
}: {
  points: RoutePoint[];
  center: [number, number];
  height?: number;
  live?: boolean;
  colors?: string[];
  /** a friend's route to overlay (ghost race) */
  ghost?: { points: RoutePoint[]; color: string };
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const dotRef = useRef<L.CircleMarker | null>(null);
  const ghostRef = useRef<L.Polyline | null>(null);
  const fitted = useRef(false);

  // `center` arrives as a fresh array on every parent render — memoize a stable
  // key so the map is created ONCE. Before this fix, the map was torn down and
  // rebuilt on every sim tick (1.5s), which was the constant flicker/glitching.
  const centerKey = `${center[0]},${center[1]}`;
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false }).setView(center, 14);
    const layer = L.tileLayer(tileUrl(), {
      maxZoom: 19,
      attribution: tileAttribution(),
    }).addTo(map);
    // If the configured tile provider fails (blocked, rate-limited, offline),
    // swap to the CARTO fallback once — invisible to the rest of the app.
    let fellBack = false;
    layer.on("tileerror", () => {
      if (fellBack) return;
      fellBack = true;
      layer.setUrl(fallbackTileUrl());
      layer.options.attribution = fallbackAttribution();
      map.attributionControl?.addAttribution(fallbackAttribution());
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      lineRef.current = null;
      dotRef.current = null;
      ghostRef.current = null;
      fitted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ghost && ghost.points.length >= 2) {
      if (!ghostRef.current) {
        ghostRef.current = L.polyline([], {
          weight: 3,
          dashArray: "6 8",
          opacity: 0.9,
          color: ghost.color,
        }).addTo(map);
      }
      ghostRef.current.setLatLngs(ghost.points.map((p) => [p.lat, p.lng]));
    } else if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }
    if (points.length < 2) return;
    if (!lineRef.current) lineRef.current = L.polyline([], { weight: 4, opacity: 0.95 }).addTo(map);

    if (colors && colors.length > 0) {
      const segs: [number, number][][] = [];
      for (let i = 1; i < points.length; i++) {
        segs.push([
          [points[i - 1].lat, points[i - 1].lng],
          [points[i].lat, points[i].lng],
        ]);
      }
      lineRef.current.setLatLngs(segs);
      (lineRef.current as unknown as { setStyle: (o: { color: string[] }) => void }).setStyle({
        color: colors,
      });
    } else {
      lineRef.current.setLatLngs(points.map((p) => [p.lat, p.lng]));
      lineRef.current.setStyle({ color: "#73976a" });
    }

    const b = lineRef.current.getBounds();
    if (!fitted.current || !map.getBounds().contains(b)) {
      map.fitBounds(b, { padding: [26, 26], maxZoom: 16 });
      fitted.current = true;
    }
    if (ghost?.points.length) {
      const gb = ghostRef.current?.getBounds();
      if (gb && (!fitted.current || !map.getBounds().contains(gb))) {
        map.fitBounds(gb, { padding: [26, 26], maxZoom: 15 });
        fitted.current = true;
      }
    }
    if (live && points.length > 0) {
      const last = points[points.length - 1];
      if (!dotRef.current) {
        dotRef.current = L.circleMarker([last.lat, last.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: "#73976a",
          fillOpacity: 1,
        }).addTo(map);
      } else {
        dotRef.current.setLatLng([last.lat, last.lng]);
      }
    }
  }, [points, live, colors, ghost]);

  return <div ref={divRef} className="map" style={{ height }} />;
}

/** Expanded workout map — memoizes the per-segment colors so the sim ticks
 *  don't re-run Leaflet updates pointlessly. */
function WorkoutMap({ route, refMs }: { route: RoutePoint[]; refMs: number }) {
  const colors = useMemo(() => segmentColors(route, refMs), [route, refMs]);
  return (
    <MapView
      points={route}
      center={[route[0].lat, route[0].lng]}
      height={190}
      colors={colors}
    />
  );
}

/** Per-segment color from speed: faster than reference → green, slower → red. */
function segmentColors(points: RoutePoint[], refMs: number): string[] {
  const colors: string[] = [];
  const green: [number, number, number] = [52, 211, 153];
  const amber: [number, number, number] = [251, 191, 36];
  const red: [number, number, number] = [248, 113, 113];
  const lerp = (a: [number, number, number], b: [number, number, number], t: number) =>
    `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    const dt = points[i].t - points[i - 1].t;
    const ms = dt > 0 ? d / dt : 0;
    const t = clamp01((refMs - ms) / (refMs * 0.55) + 0.5);
    colors.push(t < 0.5 ? lerp(green, amber, t * 2) : lerp(amber, red, (t - 0.5) * 2));
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function ZoneBar({ zones }: { zones: HRZoneMinutes }) {
  const arr = [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5];
  const total = Math.max(1, arr.reduce((a, b) => a + b, 0));
  return (
    <div className="zones-bar">
      {arr.map((v, i) => (
        <div
          key={i}
          style={{ width: `${(v / total) * 100}%`, background: ZONE_COLORS[i] }}
          title={`Z${i + 1}: ${v} min`}
        />
      ))}
    </div>
  );
}

function splitsSoFar(route: RoutePoint[]): number[] {
  const splits: number[] = [];
  let acc = 0;
  let lastT = 0;
  let nextKm = 1000;
  for (let i = 1; i < route.length; i++) {
    acc += haversineM([route[i - 1].lat, route[i - 1].lng], [route[i].lat, route[i].lng]);
    if (acc >= nextKm) {
      splits.push(Math.round(route[i].t - lastT));
      lastT = route[i].t;
      nextKm += 1000;
    }
  }
  return splits;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export type ActivityTab = "feed" | "records" | "friends";

export default function Activity({ initialTab = "feed" }: { initialTab?: ActivityTab } = {}) {
  const s = useStore();
  const rec = s.recording;
  const [picked, setPicked] = useState<ActivityType>("run");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<ActivityTab>(initialTab);
  const meEmail = s.auth?.email ?? "alex.rivera@gmail.com";
  const pendingRequests = s.friendRequests.filter(
    (r) => r.toEmail.toLowerCase() === meEmail.toLowerCase() && r.status === "pending"
  ).length;
  const max = hrMax(s.profile.age);
  const pickedDef = activityDef(picked);
  const lastFinished = s.lastFinished;

  const postInsight = useMemo(() => {
    if (!lastFinished) return null;
    const today = s.days[s.days.length - 1];
    return workoutInsight(lastFinished, {
      goalText: s.profile.goal,
      workouts: s.workouts,
      recovery: today.recovery,
      load: computeLoadBalance(s.days),
      todayIso: today.date,
    });
  }, [lastFinished, s.workouts, s.days, s.profile.goal]);

  // All hooks run unconditionally (no early return above this point) so the
  // recording view can swap in without changing the hook count.
  const week = useMemo(() => {
    const ws = addDaysIso(s.days[s.days.length - 1].date, -6); // rolling 7 days
    let km = 0;
    let sessions = 0;
    let sec = 0;
    let elev = 0;
    for (const w of s.workouts) {
      if (w.startIso.slice(0, 10) >= ws) {
        km += w.distanceM;
        sessions++;
        sec += w.durationSec;
        elev += w.elevationGainM;
      }
    }
    return { km, sessions, sec, elev };
  }, [s.workouts, s.days]);

  if (rec) return <RecordingView rec={rec} maxHr={max} gps={activityDef(rec.type).gps} />;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">Activity</span>
        </div>
        <span className="chip">
          {pickedDef.gps ? (s.gpsPos ? "GPS ready" : "sim GPS") : "indoor"}
        </span>
      </header>

      <div className="sub-tabs">
        <button className={`sub-tab ${tab === "feed" ? "active" : ""}`} onClick={() => setTab("feed")}>
          Feed
        </button>
        <button className={`sub-tab ${tab === "records" ? "active" : ""}`} onClick={() => setTab("records")}>
          Records &amp; PRs
        </button>
        <button className={`sub-tab ${tab === "friends" ? "active" : ""}`} onClick={() => setTab("friends")}>
          Friends
          {pendingRequests > 0 && <span className="tab-count">{pendingRequests}</span>}
        </button>
      </div>

      {tab === "feed" && (
        <>
          <Section title="Record a workout">
            <div className="type-grid">
              {ACTIVITY_TYPES.map((t) => (
                <button
                  key={t.type}
                  className={`type-btn ${picked === t.type ? "active" : ""}`}
                  style={picked === t.type ? { borderColor: t.color, color: t.color } : undefined}
                  onClick={() => setPicked(t.type)}
                >
                  <span className="type-icon">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <button className="btn-start" onClick={() => s.startRecording(picked)}>
              ▶ Start {activityDef(picked).label}
            </button>
            {pickedDef.gps ? (
              <GpsStatus />
            ) : (
              <p className="hint">Timer + heart-rate zones — no GPS needed for this session</p>
            )}
          </Section>

          <GhostRaceSection />

          <WeeklyCard week={week} />

          <Section title="Workout feed" right={<span className="feed-count">{s.workouts.length}</span>}>
            {s.workouts.length === 0 && <p className="hint">No workouts yet — record your first one above.</p>}
            <div className="feed">
          {s.workouts.map((w) => {
            const def = activityDef(w.type);
            const open = expanded === w.id;
            const refMs = (def.simSpeedKmh / 3.6) || 3;
            return (
              <div key={w.id} className={`wo-card ${open ? "open" : ""}`}>
                <button className="wo-head" onClick={() => setExpanded(open ? null : w.id)}>
                  <span className="wo-icon" style={{ background: `${def.color}1f`, color: def.color }}>
                    {def.icon}
                  </span>
                  <div className="wo-body">
                    <div className="wo-title">{w.title}</div>
                    <div className="wo-meta">
                      {new Date(w.startIso).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" })} ·{" "}
                      {fmtDuration(w.durationSec)}
                      {w.distanceM > 0 && <> · {fmtKm(w.distanceM)}</>}
                    </div>
                    <ZoneBar zones={w.zones} />
                  </div>
                  <div className="wo-side">
                    <span className="wo-strain">strain {w.strain.toFixed(1)}</span>
                    <span className="wo-chev">{open ? "▾" : "▸"}</span>
                  </div>
                </button>
                {open && (
                  <div className="wo-detail">
                    {w.route.length > 2 ? (
                      <WorkoutMap route={w.route} refMs={refMs} />
                    ) : (
                      <div className="no-route">Indoor session — no GPS route</div>
                    )}
                    <div className="wo-stats">
                      <div>
                        <span className="ws-label">Avg HR</span>
                        <span className="ws-value">{w.avgHr > 0 ? `${w.avgHr} bpm` : "—"}</span>
                      </div>
                      <div>
                        <span className="ws-label">Max HR</span>
                        <span className="ws-value">{w.maxHr > 0 ? `${w.maxHr} bpm` : "—"}</span>
                      </div>
                      <div>
                        <span className="ws-label">Elev gain</span>
                        <span className="ws-value">{w.elevationGainM} m</span>
                      </div>
                      <div>
                        <span className="ws-label">Pace</span>
                        <span className="ws-value">
                          {w.distanceM > 0 ? pacePerKm(w.distanceM / w.durationSec) : "—"}
                        </span>
                      </div>
                    </div>
                    {w.splitsSec.length > 0 && (
                      <div className="splits">
                        {w.splitsSec.map((sp, i) => (
                          <div key={i} className="split">
                            <span>km {i + 1}</span>
                            <span>{fmtMmSs(sp)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="zones-legend">
                      {ZONE_COLORS.map((c, i) => (
                        <span key={i}>
                          <i style={{ background: c }} />Z{i + 1} {[w.zones.z1, w.zones.z2, w.zones.z3, w.zones.z4, w.zones.z5][i]}m
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </Section>
        </>
      )}

      {tab === "records" && (
        <>
          <WeeklyCard week={week} />
          <RecordsCard />
        </>
      )}

      {tab === "friends" && <FriendsTab />}

      {lastFinished && postInsight && (
        <PostWorkoutSheet
          workout={lastFinished}
          insight={postInsight}
          ghost={s.ghostResult}
          onClose={s.dismissLastWorkout}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly summary card
// ---------------------------------------------------------------------------

function WeeklyCard({ week }: { week: { km: number; sessions: number; sec: number; elev: number } }) {
  return (
    <Section title="This week">
      <div className="week-grid">
        <div className="week-stat">
          <span className="week-num">{fmtKm(week.km)}</span>
          <span className="week-label">distance</span>
        </div>
        <div className="week-stat">
          <span className="week-num">{week.sessions}</span>
          <span className="week-label">sessions</span>
        </div>
        <div className="week-stat">
          <span className="week-num">{fmtDuration(week.sec)}</span>
          <span className="week-label">time</span>
        </div>
        <div className="week-stat">
          <span className="week-num">{week.elev} m</span>
          <span className="week-label">elevation</span>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Friends tab — requests, discovery, and your accepted friends
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function FriendsTab() {
  const s = useStore();
  const [friendId, setFriendId] = useState<string | null>(null);
  const me = s.auth?.email ?? "alex.rivera@gmail.com";
  const incoming = s.friendRequests.filter(
    (r) => r.toEmail.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  const sent = s.friendRequests.filter(
    (r) => r.fromEmail.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  const friend = friendId ? s.friends.find((f) => f.id === friendId) ?? null : null;

  return (
    <>
      <Section
        title="Friends"
        right={s.friends.length > 0 ? <span className="hint-inline">{s.friends.length}</span> : undefined}
      >
        {s.friends.length === 0 ? (
          <p className="hint">No friends yet — accept a request below or send one to a friend&apos;s email.</p>
        ) : (
          <div className="friend-list">
            {s.friends.map((f) => (
              <FriendRow key={f.id} friend={f} onOpen={() => setFriendId(f.id)} />
            ))}
          </div>
        )}
      </Section>

      {incoming.length > 0 && (
        <Section title="Friend requests" right={<span className="tab-count">{incoming.length}</span>}>
          <div className="req-list">
            {incoming.map((r) => (
              <RequestRow key={r.id} req={r} />
            ))}
          </div>
        </Section>
      )}

      <AddFriendSection />

      {sent.length > 0 && (
        <Section title="Sent requests">
          <div className="req-list">
            {sent.map((r) => (
              <SentRow key={r.id} req={r} />
            ))}
          </div>
          <p className="hint">
            Demo: the other side is a simulated account that accepts a few seconds after you
            send — in the real app they&apos;d accept on their own device.
          </p>
        </Section>
      )}

      {friend && <FriendDetail friend={friend} onClose={() => setFriendId(null)} />}
    </>
  );
}

function RequestRow({ req }: { req: FriendRequest }) {
  const s = useStore();
  return (
    <div className="req-row">
      <Avatar name={req.fromName} color={req.fromColor} avatar={req.fromAvatar} />
      <div className="friend-id">
        <div className="friend-name">{req.fromName}</div>
        <div className="friend-goal">
          {handleOf(req.fromEmail)} · {timeAgo(req.sentAt)}
        </div>
        {req.note && <div className="req-note">“{req.note}”</div>}
      </div>
      <div className="req-actions">
        <button className="chip-btn sm" onClick={() => s.acceptFriendRequest(req.id)}>
          Accept
        </button>
        <button className="chip-btn sm ghost" onClick={() => s.declineFriendRequest(req.id)}>
          Decline
        </button>
      </div>
    </div>
  );
}

function SentRow({ req }: { req: FriendRequest }) {
  const s = useStore();
  return (
    <div className="req-row">
      <Avatar name={s.auth?.name ?? "You"} color="#bd4444" avatar={s.auth?.picture ?? null} />
      <div className="friend-id">
        <div className="friend-name">{req.toEmail}</div>
        <div className="friend-goal">
          <span className="req-status pending">Pending</span> · sent {timeAgo(req.sentAt)}
        </div>
      </div>
      <button className="chip-btn sm ghost" onClick={() => s.declineFriendRequest(req.id)}>
        Cancel
      </button>
    </div>
  );
}

function AddFriendSection() {
  const s = useStore();
  const me = s.auth?.email ?? "alex.rivera@gmail.com";
  const dir = useMemo(() => directoryFor(me), [me]);
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [contacts, setContacts] = useState<DirectoryUser[] | null>(null);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [phoneMatch, setPhoneMatch] = useState<DirectoryUser | CloudPerson | null>(null);

  // Emails already friends or with a request in flight — hidden from discovery.
  const taken = useMemo(() => {
    const set = new Set<string>(s.friends.map((f) => f.email.toLowerCase()));
    for (const r of s.friendRequests) {
      if (r.status === "pending") {
        set.add(r.fromEmail.toLowerCase());
        set.add(r.toEmail.toLowerCase());
      }
    }
    return set;
  }, [s.friends, s.friendRequests]);

  const send = async (target: string) => {
    const res = await s.sendFriendRequest(target);
    if (res.ok) {
      const t = target.trim();
      setMsg({ ok: true, text: `Request sent to ${t} — they need to accept before you see their activity.` });
      setEmail("");
    } else {
      setMsg({ ok: false, text: res.error ?? "Couldn't send that request." });
    }
  };

  // When the real friends backend is live, the search box queries real
  // accounts instead of the simulated directory.
  const cloudLive = cloudFriendsAvailable(me);
  const [cloudResults, setCloudResults] = useState<CloudPerson[] | null>(null);
  const cloudSearch = useMemo(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    return (q: string) => {
      clearTimeout(t);
      if (!cloudLive || !q.trim()) {
        setCloudResults(null);
        return;
      }
      t = setTimeout(async () => {
        const hits = await searchUsersCloud(q);
        setCloudResults(hits.length ? hits : []);
      }, 350);
    };
  }, [cloudLive]);

  const shareContacts = async () => {
    setMsg(null);
    setContactsBusy(true);
    const picked = await pickContacts();
    setContactsBusy(false);
    if (!picked) {
      setContacts(null);
      setMsg({
        ok: false,
        text: contactsSupported()
          ? "No contacts were shared — try again, or find someone by phone number below."
          : "This browser can't read contacts — enter a friend's phone number below instead.",
      });
      return;
    }
    const matched = matchContactsToDirectory(picked, dir);
    setContacts(matched);
    setMsg(
      matched.length === 0
        ? { ok: true, text: "No one in your contacts is on rythm yet — send them an invite by email below." }
        : null
    );
  };

  const lookupPhone = async () => {
    if (cloudLive) {
      const hits = await lookupPhonesCloud([phoneQ]);
      const u = hits[0] ?? null;
      setPhoneMatch(u);
      setMsg(u ? null : { ok: false, text: "No rythm account found for that phone number." });
      return;
    }
    const u = findByPhone(dir, phoneQ);
    setPhoneMatch(u);
    setMsg(u ? null : { ok: false, text: "No rythm account found for that phone number." });
  };

  const filtered = dir.filter((d) => {
    if (taken.has(d.email.toLowerCase())) return false;
    if (!q.trim()) return true;
    return `${d.name} ${d.email}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  return (      <Section title="Add a friend">
      <p className="hint" style={{ marginTop: 0 }}>
        {cloudLive
          ? "This is a real directory — search other rythm users by name or email, or match your contacts by phone. They have to accept before you see their activity."
          : "Suggestions here come from <b>your</b> contacts — no random directory. Send a request and they have to accept before you see their runs and stats."}
      </p>

      {/* Find friends from your contacts */}
      <div className="contacts-cta">
        <div className="cc-body">
          <div className="cc-title">📇 Friends from your contacts</div>
          <div className="cc-sub">
            {contactsSupported()
              ? "We check who in your address book is on rythm — nothing leaves your device."
              : "This browser can't read contacts — search a phone number instead."}
          </div>
        </div>
        <button className="chip-btn cc-btn" onClick={shareContacts} disabled={contactsBusy}>
          {contactsBusy ? "Checking…" : "Check my contacts"}
        </button>
      </div>

      {contacts && contacts.length > 0 && (
        <>
          <div className="contact-match-hint">✓ Found in your contacts</div>
          <div className="dir-list">
            {contacts.map((d) => (
              <div key={d.email} className="dir-row">
                <Avatar name={d.name} color={d.color} avatar={d.avatar} />
                <div className="friend-id">
                  <div className="friend-name">{d.name}</div>
                  <div className="friend-goal">
                    {d.phone} · {d.goal}
                  </div>
                </div>
                {taken.has(d.email.toLowerCase()) ? (
                  <span className="hint-inline">connected</span>
                ) : (
                  <button className="chip-btn sm" onClick={() => send(d.email)}>
                    Request
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Manual phone lookup (fallback when the Contacts API is unavailable) */}
      {(!contactsSupported() || !contacts || contacts.length === 0) && (
        <div className="friend-add-email" style={{ marginTop: 10 }}>
          <input
            value={phoneQ}
            onChange={(e) => setPhoneQ(e.target.value)}
            placeholder="Friend's phone, e.g. +1 415 555 0131"
            type="tel"
            onKeyDown={(e) => e.key === "Enter" && lookupPhone()}
          />
          <button className="chip-btn" onClick={lookupPhone}>
            Find
          </button>
        </div>
      )}
      {phoneMatch && (
        <div className="dir-list" style={{ marginTop: 6 }}>
          <div key={phoneMatch.email} className="dir-row">
            <Avatar name={phoneMatch.name} color={phoneMatch.color} avatar={phoneMatch.avatar} />
            <div className="friend-id">
              <div className="friend-name">{phoneMatch.name}</div>
              <div className="friend-goal">
                {handleOf(phoneMatch.email)} · {phoneMatch.goal}
              </div>
            </div>
            {taken.has(phoneMatch.email.toLowerCase()) ? (
              <span className="hint-inline">connected</span>
            ) : (
              <button className="chip-btn sm" onClick={() => send(phoneMatch.email)}>
                Request
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 6 }} />
      <input
        className="search-input"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          cloudSearch(e.target.value);
        }}
        placeholder="…or search name or email"
      />
      {cloudLive && cloudResults !== null ? (
        cloudResults.length > 0 ? (
          <div className="dir-list">
            {cloudResults.map((d) => (
              <div key={d.id ?? d.email} className="dir-row">
                <Avatar name={d.name} color={d.color} avatar={d.avatar} />
                <div className="friend-id">
                  <div className="friend-name">{d.name}</div>
                  <div className="friend-goal">{handleOf(d.email)} · {d.goal}</div>
                </div>
                {taken.has(d.email.toLowerCase()) ? (
                  <span className="hint-inline">connected</span>
                ) : (
                  <button className="chip-btn sm" onClick={() => send(d.email)}>
                    Request
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">{q.trim() ? `No rythm users match “${q.trim()}”.` : "Type to search real accounts."}</p>
        )
      ) : filtered.length > 0 ? (
        <div className="dir-list">
          {filtered.map((d) => (
            <div key={d.email} className="dir-row">
              <Avatar name={d.name} color={d.color} avatar={d.avatar} />
              <div className="friend-id">
                <div className="friend-name">{d.name}</div>
                <div className="friend-goal">
                  {handleOf(d.email)} · {d.goal}
                </div>
              </div>
              <button className="chip-btn sm" onClick={() => send(d.email)}>
                Request
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">{q ? `No matches for “${q}”.` : "Everyone here is already connected."}</p>
      )}

      <div className="friend-add-email">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          type="email"
          onKeyDown={(e) => e.key === "Enter" && send(email)}
        />
        <button className="chip-btn" onClick={() => send(email)}>
          Send request
        </button>
      </div>
      {msg && <p className={`req-msg ${msg.ok ? "ok" : ""}`}>{msg.text}</p>}
    </Section>
  );
}

function FriendRow({ friend, onOpen }: { friend: Friend; onOpen: () => void }) {
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  let wkKm = 0;
  let wkSessions = 0;
  let totalKm = 0;
  for (const w of friend.workouts) {
    const t = new Date(w.startIso).getTime();
    if (t >= weekAgo) {
      wkKm += w.distanceM / 1000;
      wkSessions++;
    }
    totalKm += w.distanceM / 1000;
  }
  return (
    <button className="friend-row" onClick={onOpen}>
      <Avatar name={friend.name} color={friend.color} avatar={friend.avatar} />
      <div className="friend-id">
        <div className="friend-name">{friend.name}</div>
        <div className="friend-goal">
          {friend.email ? `${handleOf(friend.email)} · ` : ""}
          {friend.goal}
        </div>
      </div>
      <div className="friend-side">
        <span className="friend-wk">{wkSessions} · {wkKm.toFixed(1)} km</span>
        <span className="friend-total">{totalKm.toFixed(0)} km all-time</span>
      </div>
      <span className="wo-chev">▸</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Records & PRs
// ---------------------------------------------------------------------------

function RecordsCard() {
  const s = useStore();
  const records = useMemo(() => computeRecords(s.workouts), [s.workouts]);
  return (
    <Section title="Records & PRs" right={<span className="hint-inline">best of all time</span>}>
      <div className="records">
        {records.map((r) => (
          <div key={r.label} className={`record-row ${r.main ? "" : "empty"}`}>
            <span className="record-icon">{r.main ? r.icon : "🏁"}</span>
            <div className="record-label">{r.label}</div>
            {r.main ? (
              <>
                <div className="record-main">{r.main}</div>
                <div className="record-side">
                  {r.sub && <div className="record-sub">{r.sub}</div>}
                  {r.detail && <div className="record-detail">{r.detail}</div>}
                </div>
              </>
            ) : (
              <div className="record-main empty">—</div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Recording view
// ---------------------------------------------------------------------------

function RecordingView({
  rec,
  maxHr,
  gps,
}: {
  rec: RecordingState;
  maxHr: number;
  gps: boolean;
}) {
  const s = useStore();
  const elapsedSec = (s.simMin - rec.startT) * 60;
  const route = rec.points;
  const distM = useMemo(() => {
    let d = 0;
    for (let i = 1; i < route.length; i++) {
      d += haversineM([route[i - 1].lat, route[i - 1].lng], [route[i].lat, route[i].lng]);
    }
    return d;
  }, [route]);

  const curPace = useMemo(() => {
    if (route.length < 6) return null;
    const tail = route.slice(-6);
    const d = haversineM([tail[0].lat, tail[0].lng], [tail[tail.length - 1].lat, tail[tail.length - 1].lng]);
    const dt = tail[tail.length - 1].t - tail[0].t;
    return dt > 0 ? d / dt : null; // m/s
  }, [route]);

  const splits = useMemo(() => splitsSoFar(route), [route]);
  const zone = zoneFor(s.hrNow, maxHr);
  const avgHr = rec.hrSamples.length
    ? Math.round(rec.hrSamples.reduce((a, h) => a + h.hr, 0) / rec.hrSamples.length)
    : 0;

  // Ghost race: how far ahead/behind the friend's route at the same elapsed time
  const ghostDelta = useMemo(() => {
    if (!rec.ghost) return null;
    const ghostDist = distanceAtTime(rec.ghost.route, elapsedSec);
    const pace = distM / Math.max(1, elapsedSec);
    return pace > 0.5 ? Math.round((distM - ghostDist) / pace) : 0;
  }, [rec.ghost, distM, elapsedSec]);

  // Audio coach — spoken cues driven by HR/pace/ghost. Refs track the last cue
  // so the evaluator can enforce cooldowns; fires only while enabled.
  const audioState = useRef({ lastCue: null as string | null, lastCueAtSec: 0, lastKmAnnounced: 0, started: false });
  useEffect(() => {
    if (!s.audioCoachOn) return;
    const st = audioState.current;
    if (!st.started) {
      st.started = true;
      st.lastCueAtSec = -45;
      speak(rec.ghost ? `Race start. Beat ${rec.ghost.friendName}.` : `${rec.title}. Let's go.`);
    }
    const targetPaceMs = rec.ghost
      ? routeDistanceM(rec.ghost.route) / Math.max(1, rec.ghost.targetSec)
      : null;
    const cue = evaluateCue({
      hr: s.hrNow,
      hrMax: maxHr,
      targetZone: activityDef(rec.type).hrPct,
      paceMs: curPace,
      targetPaceMs,
      elapsedSec,
      ghostDeltaSec: ghostDelta,
      ghostName: rec.ghost?.friendName ?? null,
      km: distM / 1000,
      lastKmAnnounced: st.lastKmAnnounced,
      lastCue: st.lastCue,
      lastCueAtSec: st.lastCueAtSec,
    });
    if (cue) {
      speak(cue.text);
      st.lastCue = cue.text;
      st.lastCueAtSec = elapsedSec;
      st.lastKmAnnounced = Math.floor(distM / 1000);
    }
  }, [s.audioCoachOn, s.hrNow, curPace, elapsedSec, distM, rec, ghostDelta, maxHr]);

  // Silence the coach when the session ends.
  useEffect(() => () => stopSpeaking(), []);

  return (
    <div className="page">
      <header className="topbar rec">
        <div className="rec-title">
          <span className="rec-dot" />
          {rec.title}
          <span className={`rec-gps ${gps ? "" : "indoor"}`}>{gps ? (rec.usingGps ? "GPS" : "SIM") : "INDOOR"}</span>
        </div>
        <span className="chip live">{s.hrNow} bpm · Z{zone}</span>
      </header>

      {gps ? (
        <>
          <MapView
            points={route}
            center={route[0] ? [route[0].lat, route[0].lng] : [37.7694, -122.4862]}
            height={270}
            live
            ghost={rec.ghost ? { points: rec.ghost.route, color: rec.ghost.color } : undefined}
          />
          {rec.ghost && (
            <div className="ghost-banner" style={{ borderColor: rec.ghost.color }}>
              <span className="ghost-name">👻 vs {rec.ghost.friendName}</span>
              {ghostDelta !== null && ghostDelta !== 0 ? (
                <span className={`ghost-delta ${ghostDelta > 0 ? "ahead" : "behind"}`}>
                  {ghostDelta > 0 ? `${ghostDelta}s ahead` : `${Math.abs(ghostDelta)}s behind`}
                </span>
              ) : (
                <span className="ghost-delta">even</span>
              )}
            </div>
          )}
          <div className="rec-stats">
            <div className="rec-stat">
              <span className="rec-label">Time</span>
              <span className="rec-value">{fmtDuration(elapsedSec)}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Distance</span>
              <span className="rec-value">{fmtKm(distM)}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Pace</span>
              <span className="rec-value">{curPace ? pacePerKm(curPace) : "--'--\""}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Avg pace</span>
              <span className="rec-value">{distM > 0 ? pacePerKm(distM / elapsedSec) : "--'--\""}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Elev gain</span>
              <span className="rec-value">{Math.round(recElev(route))} m</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Strain</span>
              <span className="rec-value">{s.strain.toFixed(1)}</span>
            </div>
          </div>
          {splits.length > 0 && (
            <div className="splits live-splits">
              {splits.map((sp, i) => (
                <div key={i} className="split">
                  <span>km {i + 1}</span>
                  <span>{fmtMmSs(sp)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rec-stats">
            <div className="rec-stat">
              <span className="rec-label">Time</span>
              <span className="rec-value">{fmtDuration(elapsedSec)}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Heart rate</span>
              <span className="rec-value">{s.hrNow} bpm</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Avg HR</span>
              <span className="rec-value">{avgHr || "—"} bpm</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Zone min</span>
              <span className="rec-value">{Math.round(rec.weightedMinutes)}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Strain</span>
              <span className="rec-value">{s.strain.toFixed(1)}</span>
            </div>
            <div className="rec-stat">
              <span className="rec-label">Now</span>
              <span className="rec-value">Z{zone}</span>
            </div>
          </div>
          <p className="hint center">No GPS — duration, heart rate and zone minutes are what matter here.</p>
        </>
      )}

      <div className="rec-controls">
        <button className="btn-ghost" onClick={s.togglePause}>
          {rec.paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button className="btn-stop" onClick={s.stopRecording}>■ Finish</button>
      </div>
      {rec.paused && <p className="hint center">Paused — strain &amp; {gps ? "route" : "timer"} are frozen.</p>}
    </div>
  );
}

function recElev(points: RoutePoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].alt - points[i - 1].alt;
    if (d > 0) gain += d;
  }
  return gain;
}


