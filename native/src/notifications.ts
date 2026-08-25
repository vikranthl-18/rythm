// ---------------------------------------------------------------------------
// Local scheduled notifications — the v1 of "push": no push server, no Expo
// push tokens. The OS fires these on a schedule even when the app is killed,
// so testers get the daily readiness brief and weekly digest without any
// backend. (True remote push can ride on top later; the content engines in
// the web app already compute what these announce.)
//
// Prefs live in AsyncStorage so toggles survive restarts. Scheduling is
// idempotent: every change cancels all pending and re-schedules from prefs.
// ---------------------------------------------------------------------------

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFS_KEY = "rythm-notif-prefs";

export interface NotificationPrefs {
  briefEnabled: boolean;
  /** 24h clock, local device time. */
  briefHour: number;
  briefMinute: number;
  digestEnabled: boolean;
  digestHour: number;
  digestMinute: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  briefEnabled: true,
  briefHour: 7,
  briefMinute: 0,
  digestEnabled: true,
  digestHour: 8,
  digestMinute: 0,
};

// Foreground behaviour: show the alert/banner but keep it quiet-ish (the app
// is already open; a banner is enough). Must be set once, at module scope.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Android channels — required for the notification to show at all. */
async function ensureChannels(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("brief", {
      name: "Morning readiness brief",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("digest", {
      name: "Weekly digest",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  }
}

export async function loadPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: NotificationPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — in-memory prefs still apply this session */
  }
  await scheduleFromPrefs(prefs);
}

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const res = await Notifications.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/** Cancel everything and re-schedule from the given prefs (idempotent). */
export async function scheduleFromPrefs(prefs: NotificationPrefs): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* nothing scheduled yet */
  }
  await ensureChannels();
  if (prefs.briefEnabled) {
    const trigger: Notifications.NotificationTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: prefs.briefHour,
      minute: prefs.briefMinute,
    };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "☀️ Morning readiness brief",
        body: "Your Recovery, Strain and Rythm Score for today are ready — see how ready you are.",
        data: { screen: "home" },
        sound: "default",
      },
      trigger,
    });
  }
  if (prefs.digestEnabled) {
    const trigger: Notifications.NotificationTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2, // Monday
      hour: prefs.digestHour,
      minute: prefs.digestMinute,
    };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "📊 Your weekly rythm digest",
        body: "How your week went, your scores, and what's next — tap to read it.",
        data: { screen: "home" },
        sound: "default",
      },
      trigger,
    });
  }
}

/** Fire one notification immediately — the "send me a test" button. */
export async function sendTestNotification(): Promise<void> {
  await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🔔 rythm notifications work",
      body: "This is a test — your daily brief and weekly digest are now scheduled.",
      sound: "default",
    },
    trigger: null,
  });
}

/** How many notifications are currently scheduled (for the settings line). */
export async function scheduledCount(): Promise<number> {
  try {
    return (await Notifications.getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}
