// ---------------------------------------------------------------------------
// Demo data generator — deterministic (seeded RNG) so the app looks the same
// across reloads. History is produced by *running the real engines*: recovery
// comes from computeRecovery, sleep scores from computeSleepScore, sleep need
// from sleepNeedMin, strain from workout zone distributions.
// ---------------------------------------------------------------------------

import {
  type DailyMetrics,
  type Friend,
  type FriendRequest,
  type Habit,
  type Profile,
  type UserDevice,
  type Workout,
  activityDef,
} from "../types";
import { makeRand, isoDaysAgo, todayIso, uid } from "../lib/rng";
import { computeRecovery, baselineBefore } from "../engine/recovery";
import {
  computeSleepScore,
  nextSleepDebt,
  sleepNeedMin,
} from "../engine/sleep";
import { workoutStrainFromZones } from "../engine/zones";
import { fakeElevation, pathDistanceM } from "../lib/geo";

/** Race day ≈ 12 weeks out — the demo showcases the reverse-periodized plan. */
function demoRaceDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 84);
  return d.toISOString().slice(0, 10);
}

export const USER_PROFILE: Profile = {
  name: "Alex",
  age: 28,
  sex: "male",
  weightKg: 72,
  heightCm: 178,
  goal: "Sub-20 min 5k",
  // Race-mode goal — the demo shows the full plan + race-day strategy.
  race: { distanceKm: 21.0975, dateIso: demoRaceDate(), targetPaceSecPerKm: 343 },
};

/**
 * Accounts that get the seeded demo dataset — the demo chooser accounts
 * (Alex Rivera, Sam Patel). Everyone else is a REAL user and starts blank:
 * today's vitals only, no workouts, habits, devices or friend requests.
 */
export const DEMO_EMAILS = ["alex.rivera@gmail.com", "sam.patel@gmail.com"];

export function isDemoEmail(email: string | null | undefined): boolean {
  if (!email) return true; // pre-auth / demo fallback
  return DEMO_EMAILS.includes(email.trim().toLowerCase());
}

export const BASE_POINT: [number, number] = [37.7694, -122.4862]; // Golden Gate Park

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export function seedDevices(): UserDevice[] {
  const watch: UserDevice = {
    id: "dev_watch",
    name: "Pixel Watch 2",
    model: "Google Pixel Watch 2",
    source: "HEALTH_CONNECT",
    priorityRank: 1,
    battery: 64,
    connected: true,
    lastSyncMin: 2,
    color: "#60a5fa",
    specialty: ["steps", "activeEnergy", "restingHR"],
    metricOrder: {
      hr: ["dev_watch", "dev_ring", "dev_apple"],
      sleep: ["dev_ring", "dev_watch", "dev_apple"],
      restingHR: ["dev_watch", "dev_ring", "dev_apple"],
      hrv: ["dev_ring", "dev_watch", "dev_apple"],
      steps: ["dev_watch", "dev_ring", "dev_apple"],
      activeEnergy: ["dev_watch", "dev_ring", "dev_apple"],
      calories: ["dev_watch", "dev_ring", "dev_apple"],
      zoneMinutes: ["dev_watch", "dev_ring", "dev_apple"],
      skinTemp: ["dev_ring", "dev_watch", "dev_apple"],
      spo2: ["dev_ring", "dev_watch", "dev_apple"],
      respRate: ["dev_ring", "dev_watch", "dev_apple"],
    },
  };
  const ring: UserDevice = {
    id: "dev_ring",
    name: "Colmi Ring R09",
    model: "Colmi Ring R09",
    source: "BLE_DIRECT",
    priorityRank: 2,
    battery: 88,
    connected: true,
    lastSyncMin: 1,
    color: "#a78bfa",
    specialty: ["sleep", "hrv", "skinTemp", "spo2"],
    metricOrder: watch.metricOrder,
  };
  const apple: UserDevice = {
    id: "dev_apple",
    name: "Apple Watch",
    model: "Apple Watch Series 9",
    source: "HEALTHKIT",
    priorityRank: 3,
    battery: 41,
    connected: false,
    lastSyncMin: 140,
    color: "#f472b6",
    specialty: ["activeEnergy"],
    metricOrder: watch.metricOrder,
  };
  return [watch, ring, apple];
}

// ---------------------------------------------------------------------------
// Route generation (closed loop around a base point)
// ---------------------------------------------------------------------------

function genLoopRoute(
  rand: ReturnType<typeof makeRand>,
  base: [number, number],
  km: number
): [number, number][] {
  // Smooth closed loop: radii vary with continuous sine/cosine phases so
  // adjacent points stay ~km/steps apart (timestamps assume even spacing,
  // which the PR engine relies on for correct split/PR times).
  const steps = Math.max(18, Math.round(km * 40));
  const radiusDeg = km / (2 * Math.PI) / 111;
  const lngScale = 1 / Math.cos((base[0] * Math.PI) / 180);
  const phase = rand.range(0, Math.PI * 2);
  const rxPhase = rand.range(0, Math.PI * 2);
  const ryPhase = rand.range(0, Math.PI * 2);
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wob = 1 + 0.18 * Math.sin(a * 3 + phase);
    const rx = 0.92 + 0.14 * Math.sin(a * 2 + rxPhase);
    const ry = 0.92 + 0.14 * Math.cos(a * 2 + ryPhase);
    pts.push([
      base[0] + Math.sin(a) * rx * wob * radiusDeg,
      base[1] + Math.cos(a) * ry * wob * radiusDeg * lngScale,
    ]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Daily history (14 days ending today)
// ---------------------------------------------------------------------------

export function seedDays(): DailyMetrics[] {
  const rand = makeRand(1337);
  const days: DailyMetrics[] = [];
  let debtMin = 0;
  let prevStrain = 7.5;

  // A slow upward HRV trend across the window makes the charts read well.
  const hrvBase = 56;
  const rhrBase = 55.5;
  const tempBase = 36.32;

  for (let i = 13; i >= 0; i--) {
    const date = isoDaysAgo(i);
    const progress = (13 - i) / 13; // 0 → 1
    const hrv = Math.round(hrvBase + 6 * progress + rand.around(0, 7));
    const restingHR = Math.round((rhrBase - 2.5 * progress + rand.around(0, 2.2)) * 10) / 10;
    const skinTemp = Math.round((tempBase + rand.around(0, 0.22)) * 100) / 100;
    const spo2 = Math.round((97.4 + rand.around(0, 0.7)) * 10) / 10;
    const respRate = Math.round((14.4 + rand.around(0, 1.1)) * 10) / 10;
    // Steps follow a realistic daily rhythm instead of pure noise: a gentle
    // upward trend, slightly quieter weekends, a clear boost on days with a
    // logged workout (runs add more than rides; indoor sessions add some),
    // and small jitter — so the 14-day chart reads like a training week, not
    // a random zigzag.
    const weekday = new Date(date + "T12:00:00").getDay(); // 0=Sun .. 6=Sat
    const workoutBoost = workoutDayBoost()[i] ?? 0;
    const weekendAdj = weekday === 0 || weekday === 6 ? -700 : 450;
    const steps = Math.max(
      4200,
      Math.round(6200 + 1600 * progress + weekendAdj + workoutBoost + rand.range(0, 350))
    );
    const activeEnergy = Math.round(320 + workoutBoost * 0.12 + 45 * progress + rand.range(0, 130));
    const calories = 1600 + Math.round(steps * 0.045 + activeEnergy);
    const activeZoneMin = Math.round(20 + activeEnergy / 5 + rand.range(0, 12));

    const needMin = sleepNeedMin(prevStrain, debtMin);
    // today is a short night (drives the sleep-debt narrative); past nights
    // are a realistic mix that keeps the 7.5h habit partially green
    const durationMin = i === 0 ? rand.int(356, 402) : rand.int(415, 502);
    const deepMin = Math.round(durationMin * rand.range(0.15, 0.21));
    const remMin = Math.round(durationMin * rand.range(0.19, 0.26));
    const awakeMin = rand.int(8, 26);
    const lightMin = durationMin - deepMin - remMin - awakeMin;
    const score = computeSleepScore({
      durationMin,
      deepMin,
      remMin,
      awakeMin,
      needMin,
    });

    // Strain: base daily activity for past days; today accumulates live. The
    // seeded workout strain is added on top in buildSeed().
    const strain = i === 0 ? 0 : Math.round(rand.range(5, 9) * 10) / 10;
    // Overnight readings are taken when you wake — the ring's analysis runs
    // somewhere between ~05:40 and ~06:40, varying a little each morning.
    const measuredAtMin = Math.round(340 + rand.range(0, 55));
    const day: DailyMetrics = {
      date,
      measuredAtMin,
      hrv,
      restingHR,
      skinTemp,
      spo2,
      respRate,
      steps,
      activeEnergy,
      calories,
      activeZoneMin,
      sleep: { date, durationMin, deepMin, lightMin, remMin, awakeMin, needMin, score },
      recovery: 0,
      strain,
    };

    const bHrv = baselineBefore(days, date, (d) => d.hrv);
    const bRhr = baselineBefore(days, date, (d) => d.restingHR);
    const bTemp = baselineBefore(days, date, (d) => d.skinTemp);
    day.recovery = computeRecovery({
      hrv,
      baselineHrv: bHrv.baseline,
      sdHrv: bHrv.sd,
      rhr: restingHR,
      baselineRhr: bRhr.baseline,
      sdRhr: bRhr.sd,
      sleepScore: score,
      skinTemp,
      baselineTemp: bTemp.baseline,
      sdTemp: bTemp.sd,
    });

    days.push(day);
    debtMin = nextSleepDebt(needMin, durationMin, debtMin);
    prevStrain = day.strain;
  }

  return days;
}

// ---------------------------------------------------------------------------
// Workouts (seeded history; today's are recorded live)
// ---------------------------------------------------------------------------

/**
 * Extra steps on each day a seeded workout is logged (key = daysAgo). Derived
 * from the workout list so the step chart always lines up with the sessions:
 * runs/trails add ~300 steps per km, rides ~40 (you're sitting), and indoor
 * sessions still add a little walking-around. Function (not const) so
 * SEEDED_WORKOUTS — declared below — is available when seedDays runs.
 */
function workoutDayBoost(): Record<number, number> {
  const boost: Record<number, number> = {};
  for (const w of SEEDED_WORKOUTS) {
    const perKm = w.type === "cycle" ? 40 : w.km > 0 ? 300 : 0;
    const flat = w.km > 0 ? 0 : 1300;
    boost[w.daysAgo] = Math.round(w.km * perKm + flat);
  }
  return boost;
}

interface WorkoutSpec {
  id: string;
  daysAgo: number;
  type: Workout["type"];
  title: string;
  km: number;
  zones: [number, number, number, number, number];
  avgHrPct: number;
  maxHrPct: number;
  hour?: number;
}

function buildWorkout(rand: ReturnType<typeof makeRand>, s: WorkoutSpec): Workout {
  const startIso = new Date(Date.now() - s.daysAgo * 86400000);
  const durSec =
    s.km > 0
      ? Math.round((s.km / (s.type === "cycle" ? 24 : s.type === "trail" ? 8.5 : 10.5)) * 3600)
      : 48 * 60 + rand.int(0, 12) * 60;
  const indoor = activityDef(s.type).simSpeedKmh === 0;
  const latlngs = indoor ? [] : genLoopRoute(rand, BASE_POINT, s.km || 0.4);
  const distM = s.km > 0 ? Math.round(s.km * 1000) : indoor ? 0 : Math.round(pathDistanceM(latlngs));
  const [z1, z2, z3, z4, z5] = s.zones;
  const strain = workoutStrainFromZones(z1, z2, z3, z4, z5);
  const start = new Date(startIso);
  start.setHours(s.hour ?? 7, rand.int(0, 50), 0, 0);
  const end = new Date(start.getTime() + durSec * 1000);
  const avgHr = Math.round(190 * s.avgHrPct);
  const maxHr = Math.round(190 * s.maxHrPct);
  const splits = genSplits(distM, durSec, s.km > 0 && !indoor);
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    durationSec: durSec,
    distanceM: distM,
    elevationGainM: s.type === "trail" ? rand.int(190, 260) : rand.int(24, 70),
    avgHr,
    maxHr,
    strain: Math.round(strain * 10) / 10,
    zones: { z1, z2, z3, z4, z5 },
    splitsSec: splits,
    route: latlngs.map(([lat, lng], i) => ({
      lat,
      lng,
      t: Math.round((i / Math.max(1, latlngs.length - 1)) * durSec),
      hr: avgHr,
      alt: fakeElevation(lat, lng),
    })),
  };
}

const SEEDED_WORKOUTS: WorkoutSpec[] = [
  { id: "wo_13", daysAgo: 13, type: "run", title: "Easy Run", km: 5.2, zones: [14, 18, 8, 0, 0], avgHrPct: 0.74, maxHrPct: 0.82 },
  { id: "wo_10", daysAgo: 10, type: "cycle", title: "Commuter Spin", km: 22.4, zones: [20, 24, 18, 2, 0], avgHrPct: 0.7, maxHrPct: 0.83 },
  { id: "wo_8", daysAgo: 8, type: "strength", title: "Full-Body Strength", km: 0, zones: [26, 18, 10, 0, 0], avgHrPct: 0.68, maxHrPct: 0.79 },
  { id: "wo_6", daysAgo: 6, type: "trail", title: "Headlands Trail", km: 7.8, zones: [10, 22, 24, 8, 0], avgHrPct: 0.78, maxHrPct: 0.9 },
  { id: "wo_3", daysAgo: 3, type: "run", title: "Tempo Run", km: 6.4, zones: [5, 12, 22, 8, 0], avgHrPct: 0.84, maxHrPct: 0.93 },
  { id: "wo_1", daysAgo: 1, type: "run", title: "Recovery Jog", km: 4.1, zones: [24, 14, 2, 0, 0], avgHrPct: 0.68, maxHrPct: 0.76 },
  // Two evening sessions — the demo showcases the coach's cross-correlation
  // insight ("evening training costs you sleep"), which needs late workouts.
  { id: "wo_5", daysAgo: 5, type: "run", title: "Evening Tempo", km: 5.5, zones: [6, 14, 20, 6, 0], avgHrPct: 0.8, maxHrPct: 0.9, hour: 20 },
  { id: "wo_2", daysAgo: 2, type: "run", title: "Late Intervals", km: 4.8, zones: [4, 10, 18, 8, 2], avgHrPct: 0.82, maxHrPct: 0.93, hour: 21 },
];

export function seedWorkouts(): Workout[] {
  const rand = makeRand(777);
  return SEEDED_WORKOUTS.map((s) => buildWorkout(rand, s)).sort((a, b) =>
    b.startIso.localeCompare(a.startIso)
  );
}

function genSplits(distM: number, durSec: number, gps: boolean): number[] {
  const splits: number[] = [];
  if (!gps) return splits;
  const pace = durSec / Math.max(1, distM / 1000);
  const n = Math.max(1, Math.floor(distM / 1000));
  for (let i = 0; i < n; i++) {
    // pace drifts slightly (first km faster, middle harder, slight fade)
    const fade = 1 + 0.04 * Math.sin((i / n) * Math.PI * 2);
    splits.push(Math.round(pace * fade));
  }
  return splits;
}

// ---------------------------------------------------------------------------
// Friends (social layer) — real accounts, discovered by email. You don't add
// a friend by typing a name: you send a request to their email and they accept
// it. The friend's workouts only appear after the request is accepted.
// ---------------------------------------------------------------------------

export interface DirectoryUser {
  email: string;
  name: string;
  emoji: string;
  color: string;
  /** profile photo URL (falls back to initials when missing/failing) */
  avatar?: string;
  /** phone number — how the contacts matcher finds them */
  phone?: string;
  goal: string;
  /** RNG seed for their workout history */
  seed: number;
  joinedAt: string;
}

export const USER_DIRECTORY: DirectoryUser[] = [
  {
    email: "maya.chen@gmail.com",
    name: "Maya Chen",
    emoji: "🏃‍♀️",
    color: "#f472b6",
    avatar: "https://i.pravatar.cc/150?u=maya.chen",
    phone: "+1 415 555 0131",
    goal: "Sub-3:30 marathon",
    seed: 31,
    joinedAt: "2024-03-12T09:00:00Z",
  },
  {
    email: "diego.santos@gmail.com",
    name: "Diego Santos",
    emoji: "🚴",
    color: "#60a5fa",
    avatar: "https://i.pravatar.cc/150?u=diego.santos",
    phone: "+1 628 555 0177",
    goal: "First century ride",
    seed: 82,
    joinedAt: "2024-05-02T09:00:00Z",
  },
  {
    email: "priya.kapoor@gmail.com",
    name: "Priya Kapoor",
    emoji: "🧘",
    color: "#c084fc",
    avatar: "https://i.pravatar.cc/150?u=priya.kapoor",
    phone: "+1 510 555 0164",
    goal: "Strength + mobility",
    seed: 17,
    joinedAt: "2024-08-21T09:00:00Z",
  },
  {
    email: "sam.patel@gmail.com",
    name: "Sam Patel",
    emoji: "🏋️",
    color: "#c98a2d",
    avatar: "https://i.pravatar.cc/150?u=sam.patel",
    phone: "+1 650 555 0142",
    goal: "Couch to 10K",
    seed: 44,
    joinedAt: "2024-10-05T09:00:00Z",
  },
  {
    email: "elena.rossi@gmail.com",
    name: "Elena Rossi",
    emoji: "🥾",
    color: "#73976a",
    avatar: "https://i.pravatar.cc/150?u=elena.rossi",
    phone: "+1 916 555 0188",
    goal: "Trail half-marathon",
    seed: 58,
    joinedAt: "2025-01-18T09:00:00Z",
  },
];

const FRIEND_POOL: Omit<WorkoutSpec, "id" | "daysAgo">[] = [
  { type: "run", title: "Morning Run", km: 6.2, zones: [12, 18, 12, 2, 0], avgHrPct: 0.75, maxHrPct: 0.84, hour: 6 },
  { type: "run", title: "Long Run", km: 14.5, zones: [20, 28, 10, 0, 0], avgHrPct: 0.72, maxHrPct: 0.8, hour: 8 },
  { type: "trail", title: "Trail Adventure", km: 9.8, zones: [10, 20, 18, 6, 0], avgHrPct: 0.76, maxHrPct: 0.88, hour: 7 },
  { type: "run", title: "Tempo Intervals", km: 8.1, zones: [4, 10, 20, 10, 2], avgHrPct: 0.84, maxHrPct: 0.93, hour: 18 },
  { type: "cycle", title: "Road Ride", km: 32, zones: [18, 22, 14, 2, 0], avgHrPct: 0.7, maxHrPct: 0.82, hour: 9 },
  { type: "cycle", title: "Spin Class", km: 18, zones: [8, 14, 18, 8, 2], avgHrPct: 0.78, maxHrPct: 0.9, hour: 19 },
  { type: "strength", title: "Strength Session", km: 0, zones: [22, 16, 8, 0, 0], avgHrPct: 0.66, maxHrPct: 0.78, hour: 17 },
  { type: "hiit", title: "HIIT Burner", km: 0, zones: [4, 8, 14, 10, 4], avgHrPct: 0.82, maxHrPct: 0.94, hour: 18 },
  { type: "yoga", title: "Yoga Flow", km: 0, zones: [20, 6, 0, 0, 0], avgHrPct: 0.52, maxHrPct: 0.6, hour: 20 },
  { type: "walk", title: "Evening Walk", km: 4.5, zones: [30, 4, 0, 0, 0], avgHrPct: 0.55, maxHrPct: 0.62, hour: 21 },
];

export function genFriendWorkouts(randSeed: number, idPrefix: string): Workout[] {
  const rand = makeRand(randSeed);
  const n = rand.int(5, 7);
  const picked = new Set<number>();
  const specs: WorkoutSpec[] = [];
  for (let i = 0; i < n; i++) {
    let idx = rand.int(0, FRIEND_POOL.length - 1);
    while (picked.has(idx)) idx = rand.int(0, FRIEND_POOL.length - 1);
    picked.add(idx);
    const t = FRIEND_POOL[idx];
    specs.push({
      ...t,
      id: `${idPrefix}_w${i}`,
      daysAgo: rand.int(1, 13),
    });
  }
  return specs
    .map((s) => buildWorkout(rand, s))
    .sort((a, b) => b.startIso.localeCompare(a.startIso));
}

/** Friends start empty — they only appear once a request is accepted. */
export function seedFriends(): Friend[] {
  return [];
}

/** Incoming requests waiting on the current user (demo: from directory users). */
export function seedFriendRequests(toEmail: string): FriendRequest[] {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const pick = (email: string) => {
    const u = USER_DIRECTORY.find((d) => d.email === email)!;
    return u;
  };
  const mk = (email: string, note: string, ago: number): FriendRequest => {
    const u = pick(email);
    return {
      id: uid("frq"),
      fromEmail: u.email,
      fromName: u.name,
      fromEmoji: u.emoji,
      fromColor: u.color,
      fromAvatar: u.avatar,
      toEmail,
      status: "pending",
      sentAt: daysAgo(ago),
      note,
    };
  };
  return [
    mk("maya.chen@gmail.com", "Hey! Saw your 5k goal — let's keep each other honest 🙌", 1),
    mk("diego.santos@gmail.com", "We should ride the Headlands loop sometime.", 2),
    mk("priya.kapoor@gmail.com", "Strength session buddy?", 3),
  ];
}

// ---------------------------------------------------------------------------
// Habits (with 14 days of logs; biometric ones are derived from the metrics)
// ---------------------------------------------------------------------------

export function seedHabits(days: DailyMetrics[]): Habit[] {
  const rand = makeRand(2024);
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  const byDate = (daysAgo: number) => isoDaysAgo(daysAgo);

  const mk = (h: Omit<Habit, "logs" | "createdAt">): Habit => ({
    ...h,
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    logs: {},
  });

  const sleep8: Habit = mk({
    id: "hab_sleep",
    title: "Sleep 7.5 hours",
    icon: "🛌",
    color: "#818cf8",
    targetType: "DURATION",
    targetValue: 450,
    unit: "min",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 7,
    autoMetric: "sleepDuration",
    autoOp: "gte",
  });
  const water: Habit = mk({
    id: "hab_water",
    title: "Drink 2L water",
    icon: "💧",
    color: "#38bdf8",
    targetType: "NUMERIC",
    targetValue: 2000,
    unit: "ml",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 7,
    autoMetric: null,
    autoOp: null,
  });
  const run5k: Habit = mk({
    id: "hab_run",
    title: "Run 5k",
    icon: "🏃",
    color: "#73976a",
    targetType: "NUMERIC",
    targetValue: 5,
    unit: "km",
    frequency: "CUSTOM",
    customDays: [1, 3, 5],
    timesPerWeek: 2,
    autoMetric: null,
    autoOp: null,
  });
  const meditate: Habit = mk({
    id: "hab_meditate",
    title: "Meditate 10 min",
    icon: "🧘",
    color: "#c084fc",
    targetType: "DURATION",
    targetValue: 10,
    unit: "min",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 7,
    autoMetric: null,
    autoOp: null,
  });
  const strength: Habit = mk({
    id: "hab_strength",
    title: "Strength training",
    icon: "🏋️",
    color: "#fb923c",
    targetType: "BOOLEAN",
    targetValue: 1,
    unit: "",
    frequency: "CUSTOM",
    customDays: [2, 4, 6],
    timesPerWeek: 3,
    autoMetric: null,
    autoOp: null,
  });
  const steps8k: Habit = mk({
    id: "hab_steps",
    title: "Walk 8k steps",
    icon: "👣",
    color: "#a3e635",
    targetType: "NUMERIC",
    targetValue: 8000,
    unit: "steps",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 7,
    autoMetric: "steps",
    autoOp: "gte",
  });

  const all = [sleep8, water, run5k, meditate, strength, steps8k];

  for (const h of all) {
    for (let i = 13; i >= 0; i--) {
      const date = byDate(i);
      const day = dayByDate.get(date);
      if (!day) continue;
      const due =
        h.frequency === "DAILY" ||
        (h.frequency === "WEEKDAYS" && [1, 2, 3, 4, 5].includes(new Date(date + "T12:00:00").getDay())) ||
        (h.frequency === "CUSTOM" && h.customDays.includes(new Date(date + "T12:00:00").getDay()));
      if (!due) continue;

      if (h.autoMetric === "sleepDuration") {
        h.logs[date] = day.sleep.durationMin;
      } else if (h.autoMetric === "steps") {
        h.logs[date] = day.steps;
      } else if (h.id === "hab_run") {
        // patched from actual run/trail workouts in buildSeed()
        continue;
      } else {
        const p = rand.next();
        if (p < 0.72) {
          if (h.targetType === "BOOLEAN") h.logs[date] = 1;
          else if (h.targetType === "DURATION")
            h.logs[date] = Math.round(h.targetValue * rand.range(0.8, 1.4));
          else h.logs[date] = Math.round(h.targetValue * rand.range(0.6, 1.25));
        } else {
          h.logs[date] = h.targetType === "BOOLEAN" ? 0 : Math.round(h.targetValue * rand.range(0.1, 0.6));
        }
      }
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Full seed bundle
// ---------------------------------------------------------------------------

export interface SeedData {
  days: DailyMetrics[];
  workouts: Workout[];
  devices: UserDevice[];
  habits: Habit[];
  friends: Friend[];
}

export function buildSeed(): SeedData {
  const days = seedDays();
  const workouts = seedWorkouts();
  const devices = seedDevices();
  const habits = seedHabits(days);
  const friends = seedFriends();

  // Fold each workout's strain into its day so sleep-need/recovery chains
  // reflect real training days, and auto-link the "Run 5k" habit to any
  // run/trail workout that day with ≥ 5 km.
  for (const w of workouts) {
    const day = days.find((d) => d.date === w.startIso.slice(0, 10));
    if (day && day.date !== todayIso()) {
      day.strain = Math.round(Math.min(21, day.strain + w.strain) * 10) / 10;
    }
    const runHabit = habits.find((h) => h.id === "hab_run");
    const iso = w.startIso.slice(0, 10);
    if (runHabit && (w.type === "run" || w.type === "trail") && w.distanceM >= 5000) {
      runHabit.logs[iso] = Math.round((w.distanceM / 1000) * 10) / 10;
    }
  }

  // The demo showcases "what your data says" — give the two evening sessions a
  // real (synthetic) sleep cost so the correlation insight fires deterministically.
  for (const w of workouts) {
    const endHour = new Date(w.endIso).getHours();
    if (endHour < 20) continue;
    const day = days.find((d) => d.date === w.startIso.slice(0, 10));
    if (day && day.date !== todayIso()) {
      day.sleep.score = Math.max(40, day.sleep.score - 14);
      day.sleep.durationMin = Math.max(300, day.sleep.durationMin - 45);
    }
  }

  return { days, workouts, devices, habits, friends };
}
