// ---------------------------------------------------------------------------
// Global store — state, live biometric simulation, GPS recording, actions.
// The "sim" layer stands in for the Health Connect / HealthKit / BLE
// integration gateways: it produces per-device samples that flow through the
// same priority-merge engine a real device stack would use.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import {
  type ActivityType,
  type ChatMsg,
  type DailyMetrics,
  type Friend,
  type FriendRequest,
  type GhostResult,
  type Habit,
  type MetricKey,
  type Profile,
  type RecordingState,
  type RoutePoint,
  type UserDevice,
  type Workout,
  activityDef,
} from "./types";
import { makeChallenge, type Challenge, type ChallengeMetric } from "./engine/challenges";
import { USER_DIRECTORY, USER_PROFILE, isDemoEmail, seedFriendRequests, seedFriends } from "./data/seed";
import {
  accountDataFor,
  clearDeletedAccount,
  demoAccountData,
  freshAccountData,
  isDeletedAccount,
  markDeletedAccount,
  saveAccountData,
  wipeAccountKeys,
  type AccountData,
} from "./lib/accountData";
import {
  bluetoothSupported,
  pairAndStreamHr,
  reconnectBle,
  type PairedBle,
} from "./lib/bluetooth";
import {
  buildFriendFromRequest,
  directoryFor,
  validateSendRequest,
} from "./engine/friends";
import {
  acceptRequestCloud,
  cloudFriendsAvailable,
  declineRequestCloud,
  fetchFriendsCloud,
  fetchIncomingCloud,
  fetchOutgoingCloud,
  removeFriendCloud,
  sendRequestCloud,
  toFriend,
  toRequest,
} from "./lib/supabaseFriends";
import { AI_LEARNING_DAYS, learningStatus } from "./engine/aiLearning";
import {
  loadFeatures,
  saveFeatures,
  type FeatureFlags,
} from "./lib/featureFlags";
import { loadTourSeen, saveTourSeen } from "./lib/tour";
import { sendEmail } from "./lib/mail";
import { todayIso, uid } from "./lib/rng";
import { pullHealthRows, recomputeDayScores, type DeviceTruthMetric } from "./lib/healthPull";
import { fakeElevation, haversineM, routeDistanceM, timeToReachDistance } from "./lib/geo";
import { accrueStrain, hrMax, workoutStrainFromZones, zoneFor } from "./engine/zones";
import {
  buildCoachContext,
  coachReply,
  coachReplyWithLLM,
  morningBrief,
  type CoachContext,
} from "./engine/coach";
import {
  type MergeSample,
  type ResolvedReading,
  resolveLatest,
} from "./engine/priority";
import { habitDueOn } from "./engine/habits";
import { clearAuth, loadAuth, removeAccount, saveAuth, type AuthUser } from "./auth";
import { clearCloudSessionLocally, supabaseAvailable } from "./lib/supabase";
import { applyCustomColors } from "./lib/palette";
import {
  deleteCloudData,
  fetchCloudProfile,
  lastSyncedAt,
  signOutCloud,
  syncOnce,
  upsertProfile,
  type SyncResult,
} from "./lib/sync";
import { wipeLocalData } from "./lib/dataExport";
import {
  askGpsPermission,
  loadGpsPermission,
  queryGpsPermission,
  saveGpsPermission,
  type GpsPermission,
} from "./lib/location";

// ---------------------------------------------------------------------------
// Onboarding — first-run profile setup, tracked per account.
// ---------------------------------------------------------------------------

const ONBOARDED_PREFIX = "rythm-onboarded-";

export function isOnboarded(email: string): boolean {
  try {
    return localStorage.getItem(ONBOARDED_PREFIX + email.toLowerCase()) === "1";
  } catch {
    return false;
  }
}

function markOnboarded(email: string): void {
  try {
    localStorage.setItem(ONBOARDED_PREFIX + email.toLowerCase(), "1");
  } catch {
    /* ignore */
  }
}

// Per-account profile (so the onboarding details survive reloads and each
// account keeps its own metrics inputs).
const PROFILE_PREFIX = "rythm-profile-";

export function loadProfileFor(email: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_PREFIX + email.toLowerCase());
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (!p || typeof p.age !== "number" || !p.name) return null;
    return p;
  } catch {
    return null;
  }
}

function saveProfile(email: string, p: Profile): void {
  try {
    localStorage.setItem(PROFILE_PREFIX + email.toLowerCase(), JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const SIM_TICK_MS = 1500; // real ms per simulated minute
const IDLE_STEPS_PER_MIN = [30, 62];
const RUN_STEPS_PER_MIN = [140, 170];

function upsertProfileRow(email: string, name: string): void {
  // Sync the discovery fields (phone/avatar/goal) so real friends can find
  // this account, plus the full onboarding profile so a returning user on a
  // new device can restore it (fetchCloudProfile) instead of re-running
  // first-run setup. Profile edits re-run this via updateProfile.
  const profile = loadProfileFor(email);
  void upsertProfile(email, name, {
    phone: profile?.phone,
    avatar: profile?.avatar ?? undefined,
    goal: profile?.goal,
    birthday: profile?.birthday,
    age: profile?.age,
    sex: profile?.sex,
    weightKg: profile?.weightKg,
    heightCm: profile?.heightCm,
    profileCreatedAt: profile?.profileCreatedAt,
  });
}

// ---------------------------------------------------------------------------
// Cloud profile restore — onboarding + profile live in localStorage, but a
// returning user on a NEW device (fresh browser, or the APK webview) has
// neither, so the app would wrongly re-run first-run setup. On sign-in we
// fetch the account's profile from Supabase and mark them onboarded BEFORE
// the gate renders; while the lookup is in flight the App shows a brief
// restore screen instead of flashing the onboarding form.
// ---------------------------------------------------------------------------

let restoreToken = 0;

async function restoreCloudProfile(u: AuthUser): Promise<Profile | null> {
  // fetchCloudProfile checks supabase availability internally and returns
  // null when there's nothing to restore (genuinely new account).
  try {
    const p = await fetchCloudProfile(u.email);
    if (!p) return null;
    saveProfile(u.email, p);
    markOnboarded(u.email);
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cloud sync dirty-tracking. Meaningful user actions call markDirty(), which
// debounces a push ~4s after the last change (the live sim tick never counts
// as dirty — that would push on every 1.5s tick).
// ---------------------------------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function markDirty(): void {
  const s = useStore.getState();
  // Persist the account's core data immediately (this is also what cloud
  // sync snapshots — so workouts/habits actually follow the user).
  if (s.auth) {
    saveAccountData(s.auth.email, {
      days: s.days,
      workouts: s.workouts,
      habits: s.habits,
      devices: s.devices,
    } as AccountData);
  }
  if (!s.syncEnabled) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void useStore.getState().syncNow();
  }, 4000);
}

// ---------------------------------------------------------------------------
// Friends + friend requests (persisted locally; the sim stands in for a
// friends API — requests are sent by email and accepted by the other person)
// ---------------------------------------------------------------------------

// Friends + requests are per-account so a demo user's social graph never
// bleeds into a real account on the same browser.
const friendsKey = (email: string) => `rythm-friends-${email.toLowerCase()}`;
const requestsKey = (email: string) => `rythm-requests-${email.toLowerCase()}`;
const challengesKey = (email: string) => `rythm-challenges-${email.toLowerCase()}`;

function loadChallenges(email: string): Challenge[] {
  try {
    const raw = localStorage.getItem(challengesKey(email));
    if (!raw) return [];
    const list = JSON.parse(raw) as Challenge[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveChallenges(email: string, list: Challenge[]): void {
  try {
    localStorage.setItem(challengesKey(email), JSON.stringify(list));
  } catch {
    /* storage unavailable — challenges just won't persist */
  }
}

// Requests/friends saved before profile photos existed lack the avatar
// fields — backfill them from the directory so old data shows real photos.
export function loadFriends(email: string): Friend[] {
  try {
    const raw = localStorage.getItem(friendsKey(email));
    if (!raw) return seedFriends();
    const list = JSON.parse(raw) as Friend[];
    if (!Array.isArray(list)) return [];
    return list.map((f) => {
      const base = { ...f, email: f.email ?? "", joinedAt: f.joinedAt ?? "" };
      const u = USER_DIRECTORY.find((d) => d.email.toLowerCase() === base.email.toLowerCase());
      if (!u) return base;
      return {
        ...base,
        name: base.name || u.name,
        emoji: base.emoji || u.emoji,
        color: base.color || u.color,
        avatar: base.avatar || u.avatar,
        goal: base.goal || u.goal,
      };
    });
  } catch {
    return [];
  }
}

export function loadRequests(meEmail: string): FriendRequest[] {
  // Demo accounts get the seeded incoming requests; real accounts start
  // with none until someone actually sends them one.
  const seed = () => (isDemoEmail(meEmail) ? seedFriendRequests(meEmail) : []);
  try {
    const raw = localStorage.getItem(requestsKey(meEmail));
    if (!raw) return seed();
    const list = JSON.parse(raw) as FriendRequest[];
    if (!Array.isArray(list)) return [];
    return list.map((r) => {
      const u = USER_DIRECTORY.find(
        (d) => d.email.toLowerCase() === r.fromEmail.toLowerCase()
      );
      if (!u) return r;
      return {
        ...r,
        fromName: r.fromName || u.name,
        fromEmoji: r.fromEmoji || u.emoji,
        fromColor: r.fromColor || u.color,
        fromAvatar: r.fromAvatar || u.avatar,
      };
    });
  } catch {
    return seed();
  }
}

function saveFriends(email: string, list: Friend[]): void {
  try {
    localStorage.setItem(friendsKey(email), JSON.stringify(list));
  } catch {
    /* storage unavailable — social layer just won't persist */
  }
}

function saveRequests(email: string, list: FriendRequest[]): void {
  try {
    localStorage.setItem(requestsKey(email), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function meEmail(s: StoreState): string {
  return s.auth?.email ?? "alex.rivera@gmail.com";
}

export interface StoreState {
  theme: "light" | "dark";
  /** user-picked primary accent hex (null = theme default) */
  accentColor: string | null;
  /** user-picked secondary/sage hex (null = theme default) */
  greenColor: string | null;
  /** signed-in user (Google or email) — null means the auth gate shows */
  auth: AuthUser | null;
  /** false until the user completes first-run profile setup (onboarding) */
  onboarded: boolean;
  /** true while the signed-in account's profile is being restored from the
   * cloud (Supabase) — the app holds the gate on a brief restore screen so
   * returning users on a new device don't see onboarding flash */
  profileRestoring: boolean;
  /** false until the first-run feature tour is finished/skipped (per account) */
  tourSeen: boolean;
  profile: Profile;
  days: DailyMetrics[];
  workouts: Workout[];
  devices: UserDevice[];
  habits: Habit[];
  friends: Friend[];
  friendRequests: FriendRequest[];
  messages: ChatMsg[];

  // live sim
  simMin: number;
  hrNow: number;
  samples: MergeSample[];
  strain: number;
  weightedMinutes: number;
  stepsToday: number;
  liveHr: ResolvedReading | null;
  feed: Partial<Record<MetricKey, ResolvedReading | null>>;

  // recording
  recording: RecordingState | null;
  gpsPos: [number, number] | null;
  /** GPS permission state — the app never touches geolocation without consent */
  gpsPermission: GpsPermission;
  /** the most recently finished workout — drives the post-workout insight sheet */
  lastFinished: Workout | null;
  /** result of a finished ghost race (null unless you raced someone) */
  ghostResult: GhostResult | null;
  /** audio coach (spoken cues during workouts) */
  audioCoachOn: boolean;
  /** real health device over Web Bluetooth (live HR stream) */
  bleDevice: PairedBle | null;
  bleConnected: boolean;
  /** last live HR reading from the BLE device (bpm) — replaces the sim */
  bleHrNow: number | null;
  /** user-toggleable features (Settings → Features) */
  features: FeatureFlags;
  /** opt-in cloud sync (local-first default) */
  syncEnabled: boolean;
  syncStatus: "off" | "syncing" | "synced" | "error";
  lastSyncedAt: string | null;
  /** human-readable reason for the last sync failure (shown in Settings) */
  syncError: string | null;
  /** last wearable pull (health_samples) result — drives the dashboard status line */
  wearableSync: {
    status: "ok" | "empty" | "error";
    days: number;
    from: string | null;
    to: string | null;
    at: string | null;
    error?: string;
    /** device source ids the cloud actually has (hc:<origin> keys) */
    sources?: string[];
    /** raw batch counts per cloud source — diagnostics for the Devices tab */
    sourceCounts?: Record<string, number>;
  /** "who's right" comparisons when two+ devices measured the same metric */
  truth?: DeviceTruthMetric[];
} | null;
  /** group challenges (local-first v1) */
  challenges: Challenge[];
  /** true while the coach is awaiting an LLM reply (or simulating one) */
  coachTyping: boolean;

  // actions
  tick: () => void;
  setGpsPos: (pos: [number, number]) => void;
  /** prompt the browser for location; resolves ok / blocked-by-browser */
  requestGpsPermission: () => Promise<{ ok: boolean; blocked: boolean }>;
  /** set the permission state without prompting (e.g. "Not now") */
  setGpsPermission: (p: GpsPermission) => void;
  reorderDevices: (orderedIds: string[]) => void;
  cycleMetricPriority: (metric: MetricKey) => void;
  toggleDeviceConnection: (id: string) => void;
  toggleHabitToday: (id: string) => void;
  addHabit: (h: Habit) => void;
  removeHabit: (id: string) => void;
  /** create a group challenge and persist it locally (local-first v1) */
  createChallenge: (input: { title: string; icon: string; metric: ChallengeMetric; target: number; days: number; memberEmails: string[] }) => void;
  deleteChallenge: (id: string) => void;
  /** set or clear a habit log for a specific date (value null = clear) */
  setHabitLog: (id: string, date: string, value: number | null) => void;
  sendFriendRequest: (email: string) => Promise<{ ok: boolean; error?: string }>;
  acceptFriendRequest: (id: string) => void;
  declineFriendRequest: (id: string) => void;
  removeFriend: (id: string) => void;
  /** pull friends + requests from the real backend (no-op when not configured) */
  syncCloudFriends: () => Promise<void>;
  /** pull synced wearable data (health_samples) into days/devices — real accounts only */
  pullHealthSamples: () => Promise<void>;
  setTheme: (theme: "light" | "dark") => void;
  setAccentColor: (color: string | null) => void;
  setGreenColor: (color: string | null) => void;
  setAuth: (u: AuthUser) => void;
  logout: () => void;
  /** permanently delete the account + all locally stored rythm data */
  deleteAccount: () => void;
  updateProfile: (patch: Partial<Profile>) => void;
  /** finish first-run setup: store the profile details and mark onboarded */
  completeOnboarding: (patch: Partial<Profile> & { birthday: string }) => void;
  startRecording: (type: ActivityType) => void;
  /** start a live race against a friend's GPS workout (ghost overlay) */
  startGhostRace: (friend: Friend, workout: Workout) => void;
  togglePause: () => void;
  stopRecording: () => void;
  dismissLastWorkout: () => void;
  setAudioCoach: (on: boolean) => void;
  /** flip one user-toggleable feature on/off (persisted) */
  setFeature: (key: keyof FeatureFlags, on: boolean) => void;
  /** mark the first-run feature tour seen (or unseen, to replay it) */
  setTourSeen: (seen: boolean) => void;
  /** pair a BLE health device and start streaming live HR */
  pairBle: () => Promise<{ ok: boolean; error?: string }>;
  disconnectBle: () => void;
  /** update the live BLE stream state (from the stream callback) */
  setBleState: (p: { connected: boolean; hr: number | null }) => void;
  /** toggle opt-in cloud sync on/off (persisted) */
  setSyncEnabled: (on: boolean) => void;
  /** push/pull now; reloads if the cloud was newer */
  syncNow: () => Promise<SyncResult>;
  sendMessage: (text: string) => void;
  resetDemo: () => void;
}

export function nowSimMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Handle for stopping the active BLE stream (reconnect or fresh pair). */
const bleStop: { current: { stop: () => void } | null } = { current: null };

/** Overnight readings pushed by the ring (with overlapping watch copies). */
function seedMorningSamples(days: DailyMetrics[]): MergeSample[] {
  const day = days[days.length - 1];
  const s: MergeSample[] = [];
  const WAKE = 6 * 60; // readings age from ~06:00 so they stay fresh all day
  const push = (deviceId: string, metric: MetricKey, value: number) =>
    s.push({ deviceId, metric, t: WAKE, value });
  push("dev_ring", "hrv", day.hrv);
  push("dev_ring", "restingHR", day.restingHR);
  push("dev_ring", "skinTemp", day.skinTemp);
  push("dev_ring", "spo2", day.spo2);
  push("dev_ring", "respRate", day.respRate);
  push("dev_ring", "sleep", day.sleep.durationMin);
  // overlapping overnight readings from the watch (Rule 1: ring wins per its
  // per-metric priority for hrv/sleep/restingHR)
  push("dev_watch", "hrv", Math.round(day.hrv * 0.94));
  push("dev_watch", "restingHR", day.restingHR + 2);
  push("dev_watch", "sleep", Math.round(day.sleep.durationMin * 0.97));
  return s;
}

const FEED_STALE_MIN: Record<MetricKey, number> = {
  hr: 8,
  steps: 25,
  activeEnergy: 40,
  calories: 40,
  zoneMinutes: 40,
  hrv: 720,
  restingHR: 720,
  skinTemp: 720,
  spo2: 720,
  respRate: 720,
  sleep: 720,
};

function buildFeed(
  devices: UserDevice[],
  samples: MergeSample[],
  simMin: number
): Partial<Record<MetricKey, ResolvedReading | null>> {
  const feed: Partial<Record<MetricKey, ResolvedReading | null>> = {};
  for (const k of Object.keys(FEED_STALE_MIN) as MetricKey[]) {
    feed[k] = resolveLatest(k, devices, samples, simMin, FEED_STALE_MIN[k]);
  }
  return feed;
}

function loadBleDevice(): PairedBle | null {
  try {
    const raw = localStorage.getItem("rythm-ble-device");
    if (!raw) return null;
    const d = JSON.parse(raw) as PairedBle;
    return d && d.id ? d : null;
  } catch {
    return null;
  }
}

function ctxFrom(s: StoreState, strainNow: number): CoachContext {
  return buildCoachContext({
    goal: s.profile.goal,
    age: s.profile.age,
    today: s.days[s.days.length - 1] ?? null,
    strainNow,
    habits: s.habits,
    days: s.days,
    workouts: s.workouts,
    todayIso: todayIso(),
    autoHabits: s.features.autoHabits,
  });
}

function greeting(s: StoreState, strainNow: number): ChatMsg {
  // Accounts still inside the 7-day baseline window (or without onboarding
  // finished) get a friendly invite to ask anything; once baselines exist the
  // coach opens with the daily morning readiness brief.
  const learned = learningStatus(s.profile.profileCreatedAt).learned;
  const text = s.onboarded && learned
    ? `👋 Morning, ${s.profile.name}. ${morningBrief(ctxFrom(s, strainNow))}`
    : `👋 Welcome, ${s.profile.name}! I'm your coach — ask me anything about training, recovery, sleep, nutrition or your goal, and I'll answer from your data as it builds up. Once rythm learns your baselines you'll get a morning readiness brief here every day.`;
  return {
    id: uid("msg"),
    role: "coach",
    text,
    time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

export const useStore = create<StoreState>((set, get) => {
  const auth0 = loadAuth();
  const acct = accountDataFor(auth0?.email ?? null);
  const simMin0 = nowSimMin();
  const morningSamples = acct.devices.length ? seedMorningSamples(acct.days) : [];
  const liveHr = resolveLatest("hr", acct.devices, morningSamples, simMin0, 8);
  const feed = buildFeed(acct.devices, morningSamples, simMin0);
  const bleDevice0 = loadBleDevice();

  const savedTheme =
    typeof localStorage !== "undefined" && localStorage.getItem("rythm-theme") === "dark"
      ? "dark"
      : "light";

  const initial: StoreState = {
    theme: savedTheme,
    accentColor:
      typeof localStorage !== "undefined" ? (localStorage.getItem("rythm-accent") ?? null) : null,
    greenColor:
      typeof localStorage !== "undefined" ? (localStorage.getItem("rythm-green") ?? null) : null,
    auth: auth0,
    onboarded: auth0 ? isOnboarded(auth0.email) : false,
    profileRestoring: false,
    tourSeen: auth0 ? loadTourSeen(auth0.email) : false,
    profile: auth0 ? (loadProfileFor(auth0.email) ?? USER_PROFILE) : USER_PROFILE,
    days: acct.days,
    workouts: acct.workouts,
    devices: acct.devices,
    habits: acct.habits,
    friends: loadFriends(auth0?.email ?? "alex.rivera@gmail.com"),
    friendRequests: loadRequests(auth0?.email ?? "alex.rivera@gmail.com"),
    challenges: loadChallenges(auth0?.email ?? "alex.rivera@gmail.com"),
    messages: [],
    simMin: simMin0,
    hrNow: 68,
    samples: morningSamples,
    strain: 0,
    weightedMinutes: 0,
    stepsToday: 0,
    liveHr,
    feed,
    recording: null,
    gpsPos: null,
    gpsPermission: loadGpsPermission(),
    lastFinished: null,
    ghostResult: null,
    audioCoachOn:
      typeof localStorage !== "undefined" && localStorage.getItem("rythm-audio-coach") === "1",
    bleDevice: bleDevice0,
    bleConnected: false,
    bleHrNow: null,
    features: loadFeatures(),
    syncEnabled:
      typeof localStorage !== "undefined" && localStorage.getItem("rythm-sync-enabled") === "1",
    syncStatus: "off",
    lastSyncedAt: lastSyncedAt(),
    syncError: null,
    wearableSync: null,
    coachTyping: false,
    tick: () => {},
    setGpsPos: () => {},
    requestGpsPermission: async () => ({ ok: false, blocked: false }),
    setGpsPermission: () => {},
    reorderDevices: () => {},
    cycleMetricPriority: () => {},
    toggleDeviceConnection: () => {},
    toggleHabitToday: () => {},
    addHabit: () => {},
    removeHabit: () => {},
    createChallenge: () => {},
    deleteChallenge: () => {},
    setHabitLog: () => {},        sendFriendRequest: async () => ({ ok: false }),
        syncCloudFriends: async () => {},
        pullHealthSamples: async () => {},
    acceptFriendRequest: () => {},
    declineFriendRequest: () => {},
    removeFriend: () => {},
    setTheme: () => {},
    setAccentColor: () => {},
    setGreenColor: () => {},
    setAuth: () => {},
    logout: () => {},
    deleteAccount: () => {},
    updateProfile: () => {},
    completeOnboarding: () => {},
    startRecording: () => {},
    startGhostRace: () => {},
    togglePause: () => {},
    stopRecording: () => {},
    dismissLastWorkout: () => {},
    setAudioCoach: () => {},
    pairBle: async () => ({ ok: false, error: "Not ready" }),
    disconnectBle: () => {},
    setBleState: () => {},
    setFeature: () => {},
    setTourSeen: () => {},
    setSyncEnabled: () => {},
    syncNow: async () => ({ ok: false, reason: "no-supabase", applied: false, pushed: false }),
    
    sendMessage: () => {},
    resetDemo: () => {},
  };
  // greeting needs a fully-built state
  initial.messages = [greeting(initial, 0)];

  // Reconnect a previously paired BLE health device on load (no user gesture
  // needed for an already-paired device). Live HR replaces the sim.
  if (initial.bleDevice && bluetoothSupported()) {
    void reconnectBle(
      initial.bleDevice.id,
      (bpm) => set({ bleConnected: true, bleHrNow: bpm }),
      () => set({ bleConnected: false, bleHrNow: null })
    ).then((r) => {
      if (r) {
        bleStop.current = r.stop;
        set({ bleConnected: true, bleDevice: r.info });
      }
    });
  }

  return {
    ...initial,

    tick: () => {
      const s = get();
      if (s.recording?.paused) return;
      const max = hrMax(s.profile.age);
      const simMin = s.simMin + 1;
      const recording = s.recording;
      const isRecording = !!recording;

      // ---- simulation gate ------------------------------------------------
      // The sim exists to demo the product (the seeded demo account). REAL
      // accounts never get fabricated vitals — even after a Health Connect
      // pull adds device slots — their data comes from real reads. A live
      // BLE stream is real and handled separately below.
      const simOn = isDemoEmail(meEmail(s));

      // ---- heart rate -----------------------------------------------------
      // A real BLE device's live HR wins over the simulation entirely — the
      // same value feeds the dashboard, strain accumulation and recordings.
      let hr = 0;
      if (s.bleConnected && s.bleHrNow !== null) {
        // Real BLE live stream — wins over the sim for any account, and the
        // same value feeds the dashboard, strain accumulation and recordings.
        hr = Math.round(s.bleHrNow);
      } else if (simOn) {
        if (isRecording) {
          const def = activityDef(recording!.type);
          const [lo, hi] = def.hrPct;
          const wave = 0.5 + 0.5 * Math.sin(simMin / 11 + (recording!.points.length % 97) / 3);
          hr = Math.round(max * (lo + (hi - lo) * (0.3 + 0.7 * wave) + (Math.random() - 0.5) * 0.02));
        } else {
          hr = Math.round(
            Math.max(58, Math.min(112, 66 + 8 * Math.sin(simMin / 40) + (Math.random() - 0.5) * 10))
          );
        }
      }

      // ---- strain accumulation -------------------------------------------
      const ns = accrueStrain({ strain: s.strain, weightedMinutes: s.weightedMinutes }, hr, max, 1);

      const samples = [...s.samples];
      let stepsToday = s.stepsToday;
      let calories = s.days[s.days.length - 1]?.calories ?? 0;
      let activeZoneMin = s.days[s.days.length - 1]?.activeZoneMin ?? 0;
      if (simOn) {
        // ---- steps ----------------------------------------------------------
        const [sLo, sHi] = isRecording ? RUN_STEPS_PER_MIN : IDLE_STEPS_PER_MIN;
        stepsToday = s.stepsToday + sLo + Math.random() * (sHi - sLo);

        // ---- derived daily metrics (calories + active zone minutes) ----------
        calories = Math.round(1600 * (simMin / 1440) + stepsToday * 0.045);
        const zone = zoneFor(hr, max);
        const prevAzm = s.days[s.days.length - 1]?.activeZoneMin ?? 0;
        activeZoneMin = prevAzm + (zone >= 2 ? 1 : 0);

        // ---- per-device samples (simulated BLE / Health Connect pushes) -----
        const push = (deviceId: string, metric: MetricKey, value: number) =>
          samples.push({ deviceId, metric, t: simMin, value });
        if (simMin % 3 === 0) push("dev_ring", "hr", hr); // dense PPG from the ring
        if (simMin % 5 === 0) push("dev_watch", "hr", hr);
        if (simMin % 3 === 0) push("dev_watch", "steps", Math.round(stepsToday));
        if (simMin % 5 === 0) push("dev_ring", "steps", Math.round(stepsToday * 0.96));
        if (simMin % 7 === 0) push("dev_watch", "activeEnergy", Math.round(stepsToday * 0.045));
        if (simMin % 9 === 0) push("dev_watch", "calories", calories);
        if (simMin % 6 === 0) push("dev_watch", "zoneMinutes", activeZoneMin);
      }

      // ---- recording route ------------------------------------------------
      let rec: RecordingState | null = recording;
      if (isRecording && !recording!.paused) {
        // Flip to real GPS the moment permission + a fix are available — the
        // badge and route source switch from SIM to GPS without a restart.
        const useReal = s.gpsPermission === "granted" && !!s.gpsPos;
        const base = useReal && !recording!.usingGps ? { ...recording!, usingGps: true } : recording!;
        rec = advanceRecording(base, hr, s.gpsPos, (simMin - recording!.startT) * 60);
      }

      // ---- resolve live HR + merge feed -----------------------------------
      const liveHr = resolveLatest("hr", s.devices, samples, simMin, 8);
      const feed = buildFeed(s.devices, samples, simMin);

      // ---- today's row: fabricated live counters only for the demo sim; a
      // real account keeps its own (pulled/recorded) values. Strain updates
      // whenever there's a real HR source (BLE live stream).
      const days = s.days.map((d, i) =>
        i === s.days.length - 1
          ? {
              ...d,
              ...(simOn
                ? {
                    steps: Math.round(stepsToday),
                    activeEnergy: Math.round(stepsToday * 0.045),
                    calories,
                    activeZoneMin,
                  }
                : {}),
              strain: hr > 0 ? Math.round(ns.strain * 10) / 10 : d.strain,
            }
          : d
      );

      set({
        simMin,
        hrNow: hr,
        samples,
        strain: ns.strain,
        weightedMinutes: ns.weightedMinutes,
        stepsToday: Math.round(stepsToday),
        liveHr,
        feed,
        recording: rec,
        days,
      });
    },

    setGpsPos: (pos) => set({ gpsPos: pos }),

    requestGpsPermission: async () => {
      // A browser-level denial can't be re-prompted by JS — surface that so
      // the UI points the user at site settings instead of a dead button.
      const q = await queryGpsPermission();
      if (q === "denied" || q === "unsupported") {
        saveGpsPermission(q === "unsupported" ? "unsupported" : "denied");
        set({ gpsPermission: q === "unsupported" ? "unsupported" : "denied" });
        return { ok: false, blocked: q === "denied" };
      }
      const ok = await askGpsPermission();
      if (ok) {
        saveGpsPermission("granted");
        set({ gpsPermission: "granted" });
        return { ok: true, blocked: false };
      }
      saveGpsPermission("denied");
      set({ gpsPermission: "denied" });
      return { ok: false, blocked: false };
    },

    setGpsPermission: (p) => {
      saveGpsPermission(p);
      set({ gpsPermission: p });
    },

    reorderDevices: (orderedIds) => {
      const s = get();
      const ids = [...orderedIds];
      const devices = s.devices.map((d) => ({
        ...d,
        priorityRank: ids.indexOf(d.id) + 1,
        metricOrder: Object.fromEntries(
          (Object.keys(d.metricOrder) as MetricKey[]).map((k) => [k, [...ids]])
        ) as Record<MetricKey, string[]>,
      }));
      set({ devices });
      markDirty();
    },

    cycleMetricPriority: (metric) => {
      const s = get();
      const order = s.devices[0].metricOrder[metric];
      if (!order || order.length < 2) return;
      const rotated = [...order.slice(1), order[0]];
      set({
        devices: s.devices.map((d) => ({
          ...d,
          metricOrder: { ...d.metricOrder, [metric]: [...rotated] },
        })),
      });
      markDirty();
    },

    toggleDeviceConnection: (id) => {
      const s = get();
      set({
        devices: s.devices.map((d) =>
          d.id === id
            ? { ...d, connected: !d.connected, lastSyncMin: d.connected ? 9999 : 0 }
            : d
        ),
      });
      markDirty();
    },

    toggleHabitToday: (id) => {
      const s = get();
      const today = todayIso();
      set({
        habits: s.habits.map((h) => {
          if (h.id !== id || !habitDueOn(h, today)) return h;
          const logs = { ...h.logs };
          if (logs[today] !== undefined) delete logs[today];
          else logs[today] = h.targetType === "BOOLEAN" ? 1 : h.targetValue;
          return { ...h, logs };
        }),
      });
      markDirty();
    },

    addHabit: (h) => {
      set((s) => ({ habits: [...s.habits, h] }));
      markDirty();
    },

    removeHabit: (id) => {
      set((s) => ({ habits: s.habits.filter((h) => h.id !== id) }));
      markDirty();
    },

    setHabitLog: (id, date, value) => {
      set((s) => ({
        habits: s.habits.map((h) => {
          if (h.id !== id) return h;
          const logs = { ...h.logs };
          if (value === null || Number.isNaN(value)) delete logs[date];
          else logs[date] = value;
          return { ...h, logs };
        }),
      }));
      markDirty();
    },

    createChallenge: (input) => {
      const me = meEmail(get());
      const c = makeChallenge({ ...input, createdBy: me });
      set((s) => ({ challenges: [...s.challenges, c] }));
      saveChallenges(me, get().challenges);
      markDirty();
    },

    deleteChallenge: (id) => {
      const me = meEmail(get());
      set((s) => ({ challenges: s.challenges.filter((c) => c.id !== id) }));
      saveChallenges(me, get().challenges);
      markDirty();
    },

    sendFriendRequest: async (email) => {
      const s = get();
      const me = meEmail(s);
      // Real account + Supabase → the actual friends backend. The request is
      // created server-side; acceptance happens on the other user's device.
      if (cloudFriendsAvailable(me)) {
        const trimmed = email.trim();
        const res = await sendRequestCloud(trimmed);
        if (!res.ok) return { ok: false, error: res.error };
        if (res.id) {
          const req: FriendRequest = {
            id: res.id,
            fromEmail: me,
            fromName: s.profile.name,
            fromEmoji: "🙋",
            fromColor: "#bd4444",
            toEmail: trimmed.toLowerCase(),
            status: "pending",
            sentAt: new Date().toISOString(),
          };
          const st = get();
          const next = [...st.friendRequests, req];
          set({ friendRequests: next });
          saveRequests(me, next);
        }
        return { ok: true };
      }
      // Local simulated flow (demo accounts / no Supabase configured).
      const dir = directoryFor(me);
      const error = validateSendRequest(email, me, s.friends, s.friendRequests, dir);
      if (error) return { ok: false, error };
      const req: FriendRequest = {
        id: uid("frq"),
        fromEmail: me,
        fromName: s.profile.name,
        fromEmoji: "🙋",
        fromColor: "#bd4444",
        toEmail: email.trim().toLowerCase(),
        status: "pending",
        sentAt: new Date().toISOString(),
      };
      const next = [...s.friendRequests, req];
      set({ friendRequests: next });
      saveRequests(me, next);
      markDirty();
      // Demo: the recipient is a simulated account that accepts shortly after
      // the request lands — this shows the full lifecycle without a backend.
      setTimeout(() => {
        const st = get();
        // only simulate acceptance while the sender is still the same account
        if (meEmail(st).toLowerCase() !== req.fromEmail.toLowerCase()) return;
        const r = st.friendRequests.find((x) => x.id === req.id && x.status === "pending");
        if (r) get().acceptFriendRequest(r.id);
      }, 6000);
      return { ok: true };
    },

    syncCloudFriends: async () => {
      const s = get();
      const me = meEmail(s);
      if (!cloudFriendsAvailable(me)) return;
      try {
        const [cloudFriends, incoming, outgoing] = await Promise.all([
          fetchFriendsCloud(),
          fetchIncomingCloud(),
          fetchOutgoingCloud(),
        ]);
        const friends = cloudFriends.map(toFriend);
        const requests: FriendRequest[] = [
          ...incoming.map((r) => toRequest(r, me, "in")),
          ...outgoing.map((r) => toRequest(r, me, "out")),
        ];
        set({ friends, friendRequests: requests });
        saveFriends(me, friends);
        saveRequests(me, requests);
      } catch {
        /* network hiccup — keep the current local state */
      }
    },

    pullHealthSamples: async () => {
      const s = get();
      // Real accounts only — demo accounts keep their seeded dataset, and the
      // pull must never overwrite them with (or without) real data. Require
      // an actual signed-in email (never the demo fallback).
      if (!s.auth?.email || isDemoEmail(s.auth.email)) return;
      const me = s.auth.email;
      const pulled = await pullHealthRows(s.days, s.devices);
      if (!pulled.ok) {
        // Surface why nothing synced — "empty" is the normal first-run state
        // (open the Health tab and read); anything else is a real problem.
        set({
          wearableSync: {
            status: pulled.reason === "empty" ? "empty" : "error",
            days: 0,
            from: null,
            to: null,
            at: new Date().toISOString(),
            error: pulled.reason === "empty" ? undefined : pulled.error ?? pulled.reason,
          },
        });
        return;
      }
      // The pull fills raw vitals only — recompute the engine scores (sleep
      // score, recovery) from the merged days so a real user's dashboard
      // shows real numbers instead of 0.
      const days = recomputeDayScores(pulled.days ?? []);
      // Health slots are fully derived from the cloud — replace them wholesale
      // on a successful pull so renamed/merged origins (old builds pushed
      // several Google packages for the same watch, or a legacy pixel-watch
      // slot saved to account data) can't linger as phantom devices. Only true
      // BLE pairs are kept; every HEALTH_CONNECT / HEALTHKIT device is
      // re-derived from the rows each pull.
      const pulledDevices = pulled.devices ?? [];
      const devices = pulledDevices.length
        ? [...s.devices.filter((d) => d.source === "BLE_DIRECT"), ...pulledDevices]
        : s.devices;
      const cloudSources = pulledDevices.map((d) => d.id);
      // Days that actually carry real readings (not blank filler) — used for
      // the dashboard's "wearable data synced" status line.
      const withData = (pulled.days ?? []).filter(
        (d) => d.hrv > 0 || d.restingHR > 0 || d.steps > 0 || d.sleep.durationMin > 0 || d.skinTemp > 0 || d.spo2 > 0
      );
      set({
        days,
        devices,
        wearableSync: {
          status: "ok",
          days: withData.length,
          from: withData.length ? withData[0].date : null,
          to: withData.length ? withData[withData.length - 1].date : null,
          at: new Date().toISOString(),
          sources: cloudSources,
          sourceCounts: pulled.sourceCounts,
          truth: pulled.truth,
        },
      });
      saveAccountData(me, {
        days,
        workouts: get().workouts,
        habits: get().habits,
        devices,
      });
    },

    acceptFriendRequest: (id) => {
      const s = get();
      const req = s.friendRequests.find((r) => r.id === id);
      if (!req || req.status !== "pending") return;
      const me = meEmail(s);
      // Real backend: flip the request server-side, then refresh from the cloud
      // so the friend list reflects exactly what the server accepted.
      if (cloudFriendsAvailable(me)) {
        void (async () => {
          const res = await acceptRequestCloud(id);
          if (res.ok) await get().syncCloudFriends();
        })();
        return;
      }
      // The friend is whoever is on the *other* side of the request from the
      // current user (for a request I sent, that's the recipient).
      const isSender = me.toLowerCase() === req.fromEmail.toLowerCase();
      const friend = buildFriendFromRequest({
        ...req,
        fromEmail: isSender ? req.toEmail : req.fromEmail,
        fromName: isSender ? "" : req.fromName,
        fromEmoji: isSender ? "" : req.fromEmoji,
        fromColor: isSender ? "" : req.fromColor,
      });
      const nextRequests = s.friendRequests.filter((r) => r.id !== id);
      const nextFriends = [...s.friends, friend];
      set({ friendRequests: nextRequests, friends: nextFriends });
      saveRequests(me, nextRequests);
      saveFriends(me, nextFriends);
      markDirty();
    },

    declineFriendRequest: (id) => {
      const s = get();
      const me = meEmail(s);
      if (cloudFriendsAvailable(me)) {
        void (async () => {
          const res = await declineRequestCloud(id);
          if (res.ok) await get().syncCloudFriends();
        })();
        return;
      }
      const next = s.friendRequests.filter((r) => r.id !== id);
      set({ friendRequests: next });
      saveRequests(me, next);
      markDirty();
    },

    removeFriend: (id) => {
      const s = get();
      const me = meEmail(s);
      if (cloudFriendsAvailable(me)) {
        void (async () => {
          const res = await removeFriendCloud(id);
          if (res.ok) await get().syncCloudFriends();
        })();
        return;
      }
      const next = s.friends.filter((f) => f.id !== id);
      set({ friends: next });
      saveFriends(me, next);
      markDirty();
    },

    setTheme: (theme) => {
      try {
        localStorage.setItem("rythm-theme", theme);
      } catch {
        /* storage unavailable — theme just won't persist */
      }
      document.documentElement.setAttribute("data-theme", theme);
      set({ theme });
    },

    setAccentColor: (accentColor) => {
      try {
        if (accentColor) localStorage.setItem("rythm-accent", accentColor);
        else localStorage.removeItem("rythm-accent");
      } catch {
        /* storage unavailable — color just won't persist */
      }
      applyCustomColors(accentColor, get().greenColor);
      set({ accentColor });
    },

    setGreenColor: (greenColor) => {
      try {
        if (greenColor) localStorage.setItem("rythm-green", greenColor);
        else localStorage.removeItem("rythm-green");
      } catch {
        /* storage unavailable — color just won't persist */
      }
      applyCustomColors(get().accentColor, greenColor);
      set({ greenColor });
    },

    setAuth: (u) => {
      saveAuth(u);
      // If this email was deleted (tombstone), a re-signup must start truly
      // blank: wipe any residual per-account keys and skip the demo seed.
      const deleted = isDeletedAccount(u.email);
      if (deleted) {
        wipeAccountKeys(u.email);
        clearDeletedAccount(u.email);
      }
      // Every account gets its OWN data: demo accounts carry the seeded
      // dataset, real accounts start blank (freshAccountData) and keep only
      // what they actually record. Saved per-account data always wins.
      const acct = deleted ? freshAccountData() : accountDataFor(u.email);
      const samples = acct.devices.length ? seedMorningSamples(acct.days) : [];
      const next: Partial<StoreState> = {
        auth: u,
        onboarded: isOnboarded(u.email),
        tourSeen: loadTourSeen(u.email),
        profile: loadProfileFor(u.email) ?? USER_PROFILE,
        days: acct.days,
        workouts: acct.workouts,
        habits: acct.habits,
        devices: acct.devices,
        friends: deleted ? [] : loadFriends(u.email),
        friendRequests: deleted ? [] : loadRequests(u.email),
        challenges: deleted ? [] : loadChallenges(u.email),
        messages: [],
        samples,
        simMin: nowSimMin(),
        hrNow: 68,
        strain: 0,
        weightedMinutes: 0,
        stepsToday: 0,
        liveHr: resolveLatest("hr", acct.devices, samples, nowSimMin(), 8),
        feed: buildFeed(acct.devices, samples, nowSimMin()),
        recording: null,
        gpsPos: null,
        lastFinished: null,
        ghostResult: null,
        bleHrNow: null,
        bleConnected: false,
      };
      next.messages = [greeting({ ...get(), ...next } as StoreState, 0)];
      set(next);
      // Pin the blank social state so the deleted demo account stays blank
      // (its loaders would otherwise re-seed on the next reload).
      if (deleted) {
        saveFriends(u.email, []);
        saveRequests(u.email, []);
      }
      // Lazily keep the Supabase profile row in sync with the signed-in user,
      // then pull the real friends graph (requests from other accounts) and
      // any wearable data the native app synced to health_samples.
      if (supabaseAvailable) {
        void upsertProfileRow(u.email, u.name);
        void get().syncCloudFriends();
        void get().pullHealthSamples();
        // A returning account with a cloud profile skips first-run setup on
        // this device: fetch + apply it before the gate renders (App holds on
        // profileRestoring so onboarding never flashes).
        if (!isOnboarded(u.email)) {
          const token = ++restoreToken;
          set({ profileRestoring: true });
          void restoreCloudProfile(u).then((p) => {
            if (token !== restoreToken) return; // superseded by a newer sign-in
            if (p) {
              set({
                profile: p,
                onboarded: true,
                tourSeen: loadTourSeen(u.email),
                profileRestoring: false,
              });
            } else {
              set({ profileRestoring: false });
            }
          });
        }
      }
    },

    logout: () => {
      clearAuth();
      restoreToken++; // any in-flight restore belongs to the old account
      // Drop the persisted Supabase session NOW — its server revoke can lag,
      // and a relaunch in that window would auto-restore the session and log
      // the user straight back in ("log out doesn't stick").
      clearCloudSessionLocally();
      // Sign the Supabase session out too (best-effort; local logout is instant).
      void signOutCloud();
      set({ auth: null, profileRestoring: false });
    },

    deleteAccount: () => {
      const s = get();
      if (s.auth) removeAccount(s.auth.email);
      // Remove the cloud rows (best-effort, async), then everything rythm
      // stores locally under a rythm-* key (auth, profile, onboarding,
      // friends, requests, theme, last error) — wipe it all instantly.
      void deleteCloudData();
      wipeLocalData();
      // Tombstone AFTER the wipe so it survives: a re-signup with this email
      // (even the demo account) starts genuinely blank.
      if (s.auth) markDeletedAccount(s.auth.email);      // Revoke the Supabase session too — its token lives under sb-* keys,
      // which the wipe doesn't touch, and a live session would otherwise
      // restore the account on the next launch. Clear it synchronously so a
      // relaunch before the server revoke completes still starts signed out.
      clearCloudSessionLocally();
      void signOutCloud();

      restoreToken++; // any in-flight restore belongs to the deleted account
      set({ auth: null, profileRestoring: false, syncEnabled: false, syncStatus: "off", lastSyncedAt: null, syncError: null });
    },

    updateProfile: (patch) => {
      const s = get();
      const profile = { ...s.profile, ...patch };
      set({ profile });
      saveProfile(meEmail(s), profile);
      markDirty();
      // Keep the cloud profile row current so the friends directory reflects
      // name/phone/photo/goal changes immediately.
      if (supabaseAvailable) void upsertProfileRow(meEmail(s), profile.name);
    },

    completeOnboarding: (patch) => {
      const s = get();
      const email = meEmail(s);
      // The demo account represents a user who's been here for a while (the
      // seeded 14-day history) — backdate its start so the AI metrics are
      // unlocked. Every real new account starts the learning window today.
      const demo = email.toLowerCase() === "alex.rivera@gmail.com";
      const profileCreatedAt = demo
        ? new Date(Date.now() - AI_LEARNING_DAYS * 86400000).toISOString()
        : new Date().toISOString();
      const profile = { ...s.profile, ...patch, profileCreatedAt };
      // The pre-onboarding profile falls back to the demo profile (which
      // carries the demo's race plan). Real users must never inherit it —
      // their race plan only exists once they build one themselves.
      if (!demo) delete profile.race;
      set({ profile, onboarded: true });
      markOnboarded(email);
      saveProfile(email, profile);
      markDirty();
      // Mirror the full profile to the cloud row so other devices can restore
      // it (fetchCloudProfile) and skip onboarding there too.
      if (supabaseAvailable) void upsertProfileRow(email, profile.name);
      // Welcome email for real accounts — fired as they finish setup.
      // Fire-and-forget: no-op unless VITE_MAIL_API is configured.
      if (!demo) {
        void sendEmail("welcome", {
          to: email,
          name: profile.name,
          data: { goal: profile.goal },
        });
      }
    },

    startRecording: (type) => {
      const s = get();
      set({
        recording: {
          type,
          title: activityDef(type).label,
          startIso: new Date().toISOString(),
          startT: s.simMin,
          points: [],
          paused: false,
          usingGps: s.gpsPermission === "granted" && !!s.gpsPos,
          hrSamples: [],
          weightedMinutes: 0,
        },
      });
    },

    startGhostRace: (friend, workout) => {
      const s = get();
      const def = activityDef(workout.type);
      const first = friend.name.split(" ")[0];
      set({
        recording: {
          type: workout.type,
          title: `Race ${first}'s ${def.label.toLowerCase()}`,
          startIso: new Date().toISOString(),
          startT: s.simMin,
          points: [],
          paused: false,
          usingGps: false,
          hrSamples: [],
          weightedMinutes: 0,
          ghost: {
            friendName: first,
            color: friend.color || "#bd4444",
            workoutTitle: workout.title,
            route: workout.route,
            targetSec: workout.durationSec || 1,
          },
        },
      });
    },

    togglePause: () =>
      set((s) =>
        s.recording ? { recording: { ...s.recording, paused: !s.recording.paused } } : {}
      ),

    stopRecording: () => {
      const s = get();
      const rec = s.recording;
      if (!rec) return;
      const sessionSec = Math.round((s.simMin - rec.startT) * 60);
      const points = rec.points;
      const distM = routeDistanceM(points);
      const isGps = activityDef(rec.type).gps;
      // GPS sessions need a real route; indoor sessions only need time.
      if (sessionSec < 20 || (isGps && points.length < 2)) {
        set({ recording: null });
        return;
      }
      const hrs = rec.hrSamples.map((h) => h.hr);
      const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
      const maxHr = hrs.length ? Math.max(...hrs) : 0;
      const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
      const max = hrMax(s.profile.age);
      for (const h of rec.hrSamples) {
        const z = h.hr >= max * 0.9 ? 5 : h.hr >= max * 0.8 ? 4 : h.hr >= max * 0.7 ? 3 : h.hr >= max * 0.6 ? 2 : 1;
        if (z === 1) zones.z1++;
        else if (z === 2) zones.z2++;
        else if (z === 3) zones.z3++;
        else if (z === 4) zones.z4++;
        else zones.z5++;
      }
      const strain = workoutStrainFromZones(zones.z1, zones.z2, zones.z3, zones.z4, zones.z5);
      const workout: Workout = {
        id: uid("wo"),
        type: rec.type,
        title: `${distM >= 1000 ? (distM / 1000).toFixed(1) + " km " : ""}${rec.title}`,
        startIso: rec.startIso,
        endIso: new Date().toISOString(),
        durationSec: sessionSec,
        distanceM: Math.round(distM),
        elevationGainM: Math.round(elevationGain(points)),
        avgHr,
        maxHr,
        strain: Math.round(strain * 10) / 10,
        zones,
        splitsSec: computeSplits(points),
        route: points,
      };
      // Ghost-race verdict — fair comparison over the distance YOU actually ran:
      // your time vs the ghost's time at that same distance. Winning requires
      // covering their full course first; stopping short loses by default.
      let ghostResult: GhostResult | null = null;
      if (rec.ghost && rec.ghost.route.length >= 2 && sessionSec >= 60) {
        const myDist = routeDistanceM(points);
        const ghostTotal = routeDistanceM(rec.ghost.route);
        const completed = myDist >= ghostTotal * 0.99;
        let deltaSec: number;
        if (myDist >= 500) {
          const ghostTimeAtMyDist = timeToReachDistance(rec.ghost.route, myDist);
          if (ghostTimeAtMyDist !== null) {
            deltaSec = Math.round(ghostTimeAtMyDist - sessionSec);
          } else {
            // Ran further than the ghost's route — compare at their finish line.
            const myTimeAtGhostDist = timeToReachDistance(points, ghostTotal) ?? sessionSec;
            deltaSec = Math.round(rec.ghost.targetSec - myTimeAtGhostDist);
          }
        } else {
          deltaSec = -Math.round(rec.ghost.targetSec);
        }
        ghostResult = {
          friendName: rec.ghost.friendName,
          won: completed && deltaSec > 0,
          deltaSec,
          completed,
        };
      }
      set({ recording: null, workouts: [workout, ...s.workouts], lastFinished: workout, ghostResult });
      markDirty();
    },

    dismissLastWorkout: () => set({ lastFinished: null, ghostResult: null }),

    setAudioCoach: (on) => {
      try {
        localStorage.setItem("rythm-audio-coach", on ? "1" : "0");
      } catch {
        /* ignore */
      }
      set({ audioCoachOn: on });
    },

    pairBle: async () => {
      if (!bluetoothSupported()) {
        return { ok: false, error: "Bluetooth isn't available in this browser — use Chrome or Edge on a secure (HTTPS) origin." };
      }
      try {
        const { info, stop } = await pairAndStreamHr(
          (bpm) => set({ bleConnected: true, bleHrNow: bpm }),
          () => set({ bleConnected: false, bleHrNow: null })
        );
        bleStop.current = stop;
        try {
          localStorage.setItem("rythm-ble-device", JSON.stringify(info));
        } catch {
          /* ignore */
        }
        set({ bleDevice: info, bleConnected: true, bleHrNow: null });
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: msg.toLowerCase().includes("cancel") ? "Pairing cancelled." : msg,
        };
      }
    },

    disconnectBle: () => {
      try {
        bleStop.current?.stop();
      } catch {
        /* ignore */
      }
      bleStop.current = null;
      try {
        localStorage.removeItem("rythm-ble-device");
      } catch {
        /* ignore */
      }
      set({ bleConnected: false, bleHrNow: null, bleDevice: null });
    },

    setBleState: (p) => set({ bleConnected: p.connected, bleHrNow: p.hr }),

    setFeature: (key, on) => {
      const s = get();
      const features = { ...s.features, [key]: on };
      saveFeatures(features);
      set({ features });
    },

    setTourSeen: (seen) => {
      const s = get();
      if (s.auth) saveTourSeen(s.auth.email, seen);
      set({ tourSeen: seen });
    },

    setSyncEnabled: (on) => {
      try {
        localStorage.setItem("rythm-sync-enabled", on ? "1" : "0");
      } catch {
        /* ignore */
      }
      set({ syncEnabled: on, syncStatus: on ? "syncing" : "off", syncError: null });
      if (on) void get().syncNow();
    },

    syncNow: async () => {
      const s = get();
      if (!s.syncEnabled || !supabaseAvailable) {
        return { ok: false, reason: "no-supabase", applied: false, pushed: false };
      }
      set({ syncStatus: "syncing" });
      const r = await syncOnce();
      // Wearable data (health_samples) syncs independently of the opt-in
      // snapshot — refresh it whenever the user hits "Sync now" too.
      void get().pullHealthSamples();
      const syncError = r.ok
        ? null
        : r.reason === "no-session"
          ? "Sign in with Google or email (Supabase account) to sync — local demo accounts can't sync."
          : r.reason === "no-table"
            ? "Cloud sync failed: run supabase/migrations/0001_init.sql in your project's SQL Editor."
            : r.error
              ? `Sync failed: ${r.error}`
              : "Sync failed — check your connection and try again.";
      set({ syncStatus: r.ok ? "synced" : "error", lastSyncedAt: lastSyncedAt(), syncError });
      // A pull means the cloud had newer data — reload so the store
      // re-initializes from the freshly restored localStorage.
      if (r.applied) window.location.reload();
      return r;
    },

    sendMessage: async (text) => {
      const s = get();
      const msg: ChatMsg = {
        id: uid("msg"),
        role: "user",
        text,
        time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      };
      set({ messages: [...s.messages, msg], coachTyping: true });

      // LLM first (if configured AND the user hasn't switched AI off),
      // deterministic engine as the fallback.
      const started = Date.now();
      const c = ctxFrom(get(), get().strain);
      const history = get()
        .messages.filter((m) => m.id !== msg.id)
        .slice(-10)
        .map((m) => ({ role: m.role === "coach" ? ("assistant" as const) : ("user" as const), text: m.text }));
      const llmReply = get().features.aiCoach
        ? await coachReplyWithLLM(text, c, history)
        : null;
      const replyText = llmReply ?? coachReply(text, c);
      // Keep the typing indicator up for at least a beat so the chat feels
      // responsive even when the engine answers instantly (no endpoint set).
      const elapsed = Date.now() - started;
      if (elapsed < 550) await new Promise((r) => setTimeout(r, 550 - elapsed));

      const reply: ChatMsg = {
        id: uid("msg"),
        role: "coach",
        text: replyText,
        time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      };
      set({ messages: [...get().messages, reply], coachTyping: false });
      markDirty();
    },

    resetDemo: () => {
      const fresh = demoAccountData();
      const simMin = nowSimMin();
      const samples = seedMorningSamples(fresh.days);
      const me = meEmail(get());
      const base: StoreState = {
        theme: get().theme,
        accentColor: get().accentColor,
        greenColor: get().greenColor,
        auth: get().auth,
        onboarded: get().onboarded,
        profileRestoring: false,
        tourSeen: get().tourSeen,
        // Keep the real user's profile; only the demo account gets the demo one.
        profile: isDemoEmail(me) ? USER_PROFILE : get().profile,
        days: fresh.days,
        workouts: fresh.workouts,
        devices: structuredClone(fresh.devices),
        habits: fresh.habits,
        friends: seedFriends(),
        friendRequests: isDemoEmail(me) ? seedFriendRequests(me) : [],
        challenges: loadChallenges(me),
        messages: [],
        simMin,
        hrNow: 68,
        samples,
        strain: 0,
        weightedMinutes: 0,
        stepsToday: 0,
        liveHr: resolveLatest("hr", fresh.devices, samples, simMin, 8),
        feed: buildFeed(fresh.devices, samples, simMin),
        recording: null,
        gpsPos: null,
        gpsPermission: get().gpsPermission,
        lastFinished: null,
        ghostResult: null,
        audioCoachOn: get().audioCoachOn,
        bleDevice: get().bleDevice,
        bleConnected: get().bleConnected,
        bleHrNow: get().bleHrNow,
        features: get().features,
        syncEnabled: get().syncEnabled,
        syncStatus: get().syncStatus,
        lastSyncedAt: get().lastSyncedAt,
        syncError: get().syncError,
        wearableSync: get().wearableSync,
        coachTyping: false,
        tick: get().tick,
        setGpsPos: get().setGpsPos,
        requestGpsPermission: get().requestGpsPermission,
        setGpsPermission: get().setGpsPermission,
        reorderDevices: get().reorderDevices,
        cycleMetricPriority: get().cycleMetricPriority,
        toggleDeviceConnection: get().toggleDeviceConnection,
        toggleHabitToday: get().toggleHabitToday,
        addHabit: get().addHabit,
        removeHabit: get().removeHabit,
        setHabitLog: get().setHabitLog,
        createChallenge: get().createChallenge,
        deleteChallenge: get().deleteChallenge,
        sendFriendRequest: get().sendFriendRequest,
        acceptFriendRequest: get().acceptFriendRequest,
        declineFriendRequest: get().declineFriendRequest,
        removeFriend: get().removeFriend,
        syncCloudFriends: get().syncCloudFriends,
        pullHealthSamples: get().pullHealthSamples,
        setTheme: get().setTheme,
        setAccentColor: get().setAccentColor,
        setGreenColor: get().setGreenColor,
        setAuth: get().setAuth,
        logout: get().logout,
        deleteAccount: get().deleteAccount,
        updateProfile: get().updateProfile,
        completeOnboarding: get().completeOnboarding,
        startRecording: get().startRecording,
        startGhostRace: get().startGhostRace,
        togglePause: get().togglePause,
        stopRecording: get().stopRecording,
        dismissLastWorkout: get().dismissLastWorkout,
        setAudioCoach: get().setAudioCoach,
        pairBle: get().pairBle,
        disconnectBle: get().disconnectBle,
        setBleState: get().setBleState,
        setFeature: get().setFeature,
        setTourSeen: get().setTourSeen,
        setSyncEnabled: get().setSyncEnabled,
        syncNow: get().syncNow,
        sendMessage: get().sendMessage,
        resetDemo: get().resetDemo,
      };
      base.messages = [greeting(base, 0)];
      set(base);
      saveFriends(me, get().friends);
      saveRequests(me, get().friendRequests);
      const a = get().auth;
      if (a) {
        if (isDemoEmail(a.email)) saveProfile(a.email, USER_PROFILE);
        saveAccountData(a.email, {
          days: get().days,
          workouts: get().workouts,
          habits: get().habits,
          devices: get().devices,
        });
      }
      markDirty();
    },
  };
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------



function elevationGain(points: RoutePoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].alt - points[i - 1].alt;
    if (d > 0) gain += d;
  }
  return gain;
}

function computeSplits(points: RoutePoint[]): number[] {
  const splits: number[] = [];
  let acc = 0;
  let lastIdx = 0;
  let nextKm = 1000;
  for (let i = 1; i < points.length; i++) {
    acc += haversineM([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    if (acc >= nextKm) {
      splits.push(Math.round(points[i].t - points[lastIdx].t));
      lastIdx = i;
      nextKm += 1000;
    }
  }
  return splits;
}

const DEFAULT_START: [number, number] = [37.7694, -122.4862];

function advanceRecording(
  rec: RecordingState,
  hr: number,
  gpsPos: [number, number] | null,
  sessionSec: number
): RecordingState {
  const def = activityDef(rec.type);
  const points = [...rec.points];
  // A device-less real account records the route (GPS) but has no heart rate
  // — don't fabricate a 0 bpm sample into the workout.
  const hrSamples = hr > 0 ? [...rec.hrSamples, { t: sessionSec, hr }] : rec.hrSamples;

  if (rec.usingGps && gpsPos) {
    points.push({
      lat: gpsPos[0],
      lng: gpsPos[1],
      t: sessionSec,
      hr,
      alt: fakeElevation(gpsPos[0], gpsPos[1]),
    });
    return { ...rec, points, hrSamples };
  }

  // Indoor / non-GPS activities record HR without route points.
  if (def.simSpeedKmh === 0) {
    return { ...rec, points, hrSamples };
  }

  // simulate a smooth wandering loop
  const start = gpsPos ?? DEFAULT_START;
  const last = points[points.length - 1];
  let lat = last ? last.lat : start[0];
  let lng = last ? last.lng : start[1];
  let bearing = last
    ? Math.atan2(last.lng - points[points.length - 2].lng, last.lat - points[points.length - 2].lat)
    : Math.random() * Math.PI * 2;
  const metersPerMin = def.simSpeedKmh * 1000; // meters per simulated hour → /60
  const stepM = metersPerMin / 60 / 20;
  const baseT = sessionSec - 60; // start of this simulated minute
  for (let i = 0; i < 20; i++) {
    const toStart = Math.atan2(
      start[0] - lat,
      (start[1] - lng) * Math.cos((lat * Math.PI) / 180)
    );
    bearing += (toStart - bearing) * 0.012 + (Math.random() - 0.5) * 0.28;
    const dLat = (stepM * Math.cos(bearing)) / 111320;
    const dLng = (stepM * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
    lat += dLat;
    lng += dLng;
    points.push({
      lat,
      lng,
      t: Math.round(baseT + ((i + 1) * 60) / 20),
      hr,
      alt: fakeElevation(lat, lng),
    });
  }
  return { ...rec, points, hrSamples };
}
