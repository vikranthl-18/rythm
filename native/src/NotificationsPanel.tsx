// ---------------------------------------------------------------------------
// Notifications settings — lives at the bottom of the Health tab (the native
// side of the shell). Toggles for the daily readiness brief and weekly
// digest, a time picker for the brief, a "send test" button, and a status
// line showing permission + how many notifications are scheduled.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import {
  DEFAULT_PREFS,
  loadPrefs,
  requestNotificationPermission,
  savePrefs,
  scheduledCount,
  sendTestNotification,
  type NotificationPrefs,
} from "./notifications";

const HOURS = [6, 7, 8, 9, 10];

function fmtTime(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

export default function NotificationsPanel() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const p = await loadPrefs();
    setPrefs(p);
    setPermission(await requestNotificationPermission());
    setCount(await scheduledCount());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      if (!prefs) return;
      const next = { ...prefs, ...patch };
      setPrefs(next);
      await savePrefs(next);
      setCount(await scheduledCount());
    },
    [prefs]
  );

  if (!prefs) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#bd4444" />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🔔 Notifications</Text>
      <Text style={styles.sub}>
        Scheduled locally on this phone — they fire even when the app is closed.
      </Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Morning readiness brief</Text>
          <Text style={styles.rowHint}>daily · {fmtTime(prefs.briefHour, prefs.briefMinute)}</Text>
        </View>
        <Switch
          value={prefs.briefEnabled}
          onValueChange={(v) => void update({ briefEnabled: v })}
          trackColor={{ true: "#677e61" }}
        />
      </View>

      {prefs.briefEnabled && (
        <View style={styles.hourRow}>
          {HOURS.map((h) => (
            <TouchableOpacity
              key={h}
              style={[styles.hourChip, prefs.briefHour === h && styles.hourChipOn]}
              onPress={() => void update({ briefHour: h, briefMinute: 0 })}
            >
              <Text style={[styles.hourChipText, prefs.briefHour === h && styles.hourChipTextOn]}>
                {fmtTime(h, 0)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Weekly digest</Text>
          <Text style={styles.rowHint}>every Monday · {fmtTime(prefs.digestHour, prefs.digestMinute)}</Text>
        </View>
        <Switch
          value={prefs.digestEnabled}
          onValueChange={(v) => void update({ digestEnabled: v })}
          trackColor={{ true: "#677e61" }}
        />
      </View>

      <TouchableOpacity
        style={[styles.btn, styles.btnGhost]}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setMsg(null);
            const granted = await requestNotificationPermission();
            setPermission(granted);
            if (!granted) {
              setMsg("Notifications are blocked — enable them in system Settings → Apps → rythm → Notifications.");
            } else {
              await sendTestNotification();
              setMsg("Test notification sent ✓");
            }
            setBusy(false);
          })()
        }
        disabled={busy}
      >
        <Text style={[styles.btnText, { color: "#bd4444" }]}>
          {busy ? "Sending…" : "Send me a test notification"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.status}>
        {permission === false
          ? "⚠️ Notifications are blocked in system settings"
          : count > 0
            ? `✓ ${count} notification${count === 1 ? "" : "s"} scheduled`
            : "No notifications scheduled — enable one above"}
        {msg ? ` · ${msg}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 24, backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "rgba(0,0,0,.08)" },
  title: { fontWeight: "800", color: "#bd4444", fontSize: 16 },
  sub: { marginTop: 4, color: "#6b6257", fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontWeight: "700", color: "#3b3229", fontSize: 14 },
  rowHint: { marginTop: 2, color: "#8a8177", fontSize: 12 },
  hourRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  hourChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#f6efe2", borderWidth: 1, borderColor: "rgba(0,0,0,.08)" },
  hourChipOn: { backgroundColor: "#677e61", borderColor: "#677e61" },
  hourChipText: { color: "#6b6257", fontWeight: "700", fontSize: 12 },
  hourChipTextOn: { color: "#fff" },
  btn: { marginTop: 16, padding: 12, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: "#bd4444" },
  btnGhost: { backgroundColor: "transparent" },
  btnText: { fontWeight: "700" },
  status: { marginTop: 10, color: "#3f6b37", fontSize: 11, lineHeight: 15 },
});
