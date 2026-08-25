// ---------------------------------------------------------------------------
// rythm — shared domain types
// Mirrors the PostgreSQL schema in server/schema.sql (web demo keeps state
// client-side; the engines are pure TS so they port to the React Native app).
// ---------------------------------------------------------------------------

export type DeviceSource = "HEALTH_CONNECT" | "HEALTHKIT" | "BLE_DIRECT";

/** Metric categories the priority engine can rank devices per category. */
export type MetricKey =
  | "hr"
  | "sleep"
  | "restingHR"
  | "hrv"
  | "steps"
  | "activeEnergy"
  | "calories"
  | "zoneMinutes"
  | "skinTemp"
  | "spo2"
  | "respRate";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  icon: string;
  blurb: string;
}

export const METRICS: MetricDef[] = [
  { key: "hr", label: "Heart Rate", unit: "bpm", icon: "❤️", blurb: "Live daytime HR" },
  { key: "sleep", label: "Sleep", unit: "h", icon: "🛌", blurb: "Duration & stages" },
  { key: "restingHR", label: "Resting HR", unit: "bpm", icon: "🫀", blurb: "Overnight low" },
  { key: "hrv", label: "HRV", unit: "ms", icon: "🧠", blurb: "Overnight RMSSD" },
  { key: "steps", label: "Steps", unit: "", icon: "👟", blurb: "Daily step count" },
  { key: "activeEnergy", label: "Active Energy", unit: "kcal", icon: "💪", blurb: "Exercise calories" },
  { key: "calories", label: "Calories", unit: "kcal", icon: "🔥", blurb: "Total energy burned" },
  { key: "zoneMinutes", label: "Zone Minutes", unit: "min", icon: "⚡", blurb: "Active time in Z2+" },
  { key: "skinTemp", label: "Skin Temp", unit: "°C", icon: "🌡️", blurb: "Overnight wrist temp" },
  { key: "spo2", label: "SpO₂", unit: "%", icon: "🫁", blurb: "Blood oxygen" },
  { key: "respRate", label: "Resp Rate", unit: "/min", icon: "🌬️", blurb: "Overnight breathing" },
];

export const metricDef = (key: MetricKey): MetricDef =>
  METRICS.find((m) => m.key === key)!;

export interface Friend {
  id: string;
  name: string;
  /** account email the request was accepted from ("" for legacy demo rows) */
  email: string;
  /** when the account joined rythm */
  joinedAt: string;
  emoji: string;
  color: string;
  goal: string;
  /** profile photo URL (falls back to initials when missing/failing) */
  avatar?: string;
  workouts: Workout[];
}

export type FriendRequestStatus = "pending" | "accepted" | "declined";

/** A friend request between two accounts (identified by email). */
export interface FriendRequest {
  id: string;
  /** the account that sent the request */
  fromEmail: string;
  fromName: string;
  fromEmoji: string;
  fromColor: string;
  /** profile photo URL of the sender (falls back to initials) */
  fromAvatar?: string;
  /** the account that receives it */
  toEmail: string;
  status: FriendRequestStatus;
  sentAt: string;
  note?: string;
}

export interface UserDevice {
  id: string;
  name: string;
  model: string;
  source: DeviceSource;
  /** Slot rank 1..3 (1 = primary). */
  priorityRank: number;
  battery: number;
  connected: boolean;
  lastSyncMin: number;
  color: string;
  /** Per-metric priority: ordered device ids, most preferred first. */
  metricOrder: Record<MetricKey, string[]>;
  /** Primary health metric this device specializes in (for the UI blurb). */
  specialty: MetricKey[];
}

export interface SleepDay {
  date: string; // YYYY-MM-DD
  durationMin: number;
  deepMin: number;
  lightMin: number;
  remMin: number;
  awakeMin: number;
  needMin: number;
  score: number; // 0-100, computed by sleep engine
}

export interface DailyMetrics {
  date: string;
  /** sim minutes since midnight when the overnight vitals were taken (e.g. the ring's morning reading ~06:00) */
  measuredAtMin: number;
  hrv: number;
  restingHR: number;
  skinTemp: number;
  spo2: number;
  respRate: number;
  steps: number;
  activeEnergy: number;
  /** Total energy burned (BMR + activity). */
  calories: number;
  /** Active minutes in HR zone 2 or above. */
  activeZoneMin: number;
  sleep: SleepDay;
  /** Computed by the recovery engine. */
  recovery: number;
  /** Final strain for that day (seeded from workouts + activity). */
  strain: number;
  /**
   * Intraday readings pulled from the native health bridge, keyed by metric:
   * `t` = minutes since local midnight of this day, `value` = the reading at
   * that time (steps = steps in that hour). Drives the same-day "up and down"
   * charts in metric details. Absent for days without a device pull.
   */
  intraday?: Partial<Record<MetricKey, { t: number; value: number }[]>>;
}

export interface Profile {
  name: string;
  /** YYYY-MM-DD — collected during onboarding; `age` is derived from it */
  birthday?: string;
  /** ISO timestamp when the app started watching this user — drives the AI metrics learning window */
  profileCreatedAt?: string;
  age: number;
  sex: "male" | "female";
  weightKg: number;
  heightCm: number;
  goal: string;
  /** Phone number — used to match friends from your contacts. */
  phone?: string;
  /** Profile photo URL (Google picture or uploaded) — shown in the friends UI. */
  avatar?: string;
  /** Race-mode goal (reverse-periodized plan) — set from the race plan sheet. */
  race?: RaceConfig;
}

/** A race goal: distance + date (+ optional target pace) for periodization. */
export interface RaceConfig {
  distanceKm: number;
  /** YYYY-MM-DD race day */
  dateIso: string;
  /** optional goal pace, seconds per km */
  targetPaceSecPerKm?: number;
}

/** A friend's workout you're racing live (ghost overlay). */
export interface GhostRace {
  friendName: string;
  color: string;
  workoutTitle: string;
  /** their route (with per-point times) — the ghost line */
  route: RoutePoint[];
  /** their total duration in seconds (the time to beat) */
  targetSec: number;
}

/** Result of a finished ghost race. */
export interface GhostResult {
  friendName: string;
  won: boolean;
  /** how much you beat them by (positive) or lost by (negative), seconds */
  deltaSec: number;
  /** true when you covered the full ghost course */
  completed: boolean;
}

export type ActivityType =
  | "run"
  | "trail"
  | "cycle"
  | "walk"
  | "hiit"
  | "strength"
  | "yoga";

export interface ActivityTypeDef {
  type: ActivityType;
  label: string;
  icon: string;
  /** km/h speed the GPS simulator cruises at. 0 = indoor, no route. */
  simSpeedKmh: number;
  /** Whether the workout records a GPS route. */
  gps: boolean;
  /** HR band during a simulated session, as % of HRmax. */
  hrPct: [number, number];
  color: string;
}

export const ACTIVITY_TYPES: ActivityTypeDef[] = [
  { type: "run", label: "Run", icon: "🏃", simSpeedKmh: 10.5, gps: true, hrPct: [0.72, 0.87], color: "#73976a" },
  { type: "trail", label: "Trail", icon: "🥾", simSpeedKmh: 8.2, gps: true, hrPct: [0.74, 0.89], color: "#4ade80" },
  { type: "cycle", label: "Cycle", icon: "🚴", simSpeedKmh: 24, gps: true, hrPct: [0.68, 0.84], color: "#60a5fa" },
  { type: "walk", label: "Walk", icon: "🚶", simSpeedKmh: 5.2, gps: true, hrPct: [0.5, 0.62], color: "#a3e635" },
  { type: "hiit", label: "HIIT", icon: "⚡", simSpeedKmh: 0, gps: false, hrPct: [0.82, 0.95], color: "#fb923c" },
  { type: "strength", label: "Strength", icon: "🏋️", simSpeedKmh: 0, gps: false, hrPct: [0.6, 0.8], color: "#c084fc" },
  { type: "yoga", label: "Yoga", icon: "🧘", simSpeedKmh: 0, gps: false, hrPct: [0.45, 0.6], color: "#f472b6" },
];

export const activityDef = (type: ActivityType): ActivityTypeDef =>
  ACTIVITY_TYPES.find((a) => a.type === type)!;

export interface HRZoneMinutes {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export interface Workout {
  id: string;
  type: ActivityType;
  title: string;
  startIso: string;
  endIso: string;
  durationSec: number;
  distanceM: number;
  elevationGainM: number;
  avgHr: number;
  maxHr: number;
  strain: number;
  zones: HRZoneMinutes;
  /** Pace seconds per km. */
  splitsSec: number[];
  /** GPS track with per-point time/HR/altitude (enables pace-colored maps). */
  route: RoutePoint[];
}

export type HabitTargetType = "BOOLEAN" | "NUMERIC" | "DURATION";
export type HabitFrequency = "DAILY" | "WEEKDAYS" | "CUSTOM";

export interface Habit {
  id: string;
  title: string;
  icon: string;
  color: string;
  targetType: HabitTargetType;
  targetValue: number;
  unit: string;
  frequency: HabitFrequency;
  customDays: number[]; // 0=Sun..6=Sat, used when frequency === "CUSTOM"
  timesPerWeek: number; // used when frequency === "CUSTOM"
  /** Link to a health metric for auto-completion (auto-sync). */
  autoMetric: MetricKey | "sleepDuration" | null;
  autoOp: "gte" | "lte" | null;
  /** log_date -> recorded value (1/0 for BOOLEAN, or the measured amount). */
  logs: Record<string, number>;
  createdAt: string;
}

export interface ChatMsg {
  id: string;
  role: "user" | "coach";
  text: string;
  time: string;
}

export interface LiveSample {
  /** sim minutes since midnight */
  t: number;
  hr: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  t: number; // seconds since session start
  hr: number;
  alt: number;
}

export type RecordingState = {
  type: ActivityType;
  title: string;
  startIso: string;
  startT: number; // sim minutes at start
  points: RoutePoint[];
  paused: boolean;
  usingGps: boolean;
  hrSamples: LiveSample[];
  weightedMinutes: number;
  /** when racing a friend's workout, the ghost to overlay + beat */
  ghost?: GhostRace;
};

export const RECOVERY_GREEN = 67;
export const RECOVERY_YELLOW = 34;

export type RecoveryColor = "green" | "yellow" | "red";

export function recoveryColor(score: number): RecoveryColor {
  if (score >= RECOVERY_GREEN) return "green";
  if (score >= RECOVERY_YELLOW) return "yellow";
  return "red";
}
