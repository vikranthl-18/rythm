import { useState } from "react";
import { useStore } from "../store";
import { METRICS, type MetricKey, metricDef } from "../types";
import { effectiveOrder, slotColor } from "../engine/priority";
import MetricDetail from "../components/MetricDetail";
import { Section } from "../components/ui";
import { bluetoothSupported } from "../lib/bluetooth";
import { canonicalSourceCounts, friendlySourceName, shortOriginLabel } from "../lib/healthPull";

const SOURCE_LABEL: Record<string, string> = {
  HEALTH_CONNECT: "Health Connect",
  HEALTHKIT: "HealthKit",
  BLE_DIRECT: "BLE direct",
};

export default function Devices() {
  const s = useStore();
  const [detail, setDetail] = useState<MetricKey | null>(null);
  const [bleMsg, setBleMsg] = useState<string | null>(null);
  const [bleBusy, setBleBusy] = useState(false);
  const byRank = [...s.devices].sort((a, b) => a.priorityRank - b.priorityRank);

  const pairBle = async () => {
    setBleBusy(true);
    setBleMsg(null);
    const r = await s.pairBle();
    setBleBusy(false);
    if (!r.ok) setBleMsg(r.error ?? "Pairing failed.");
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = byRank.findIndex((d) => d.id === id);
    const j = idx + dir;
    if (j < 0 || j >= byRank.length) return;
    const ids = byRank.map((d) => d.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    s.reorderDevices(ids);
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">Devices</span>
        </div>
      </header>

      {/* Real health device over Bluetooth — live HR replaces the sim */}
      <Section title="Bluetooth health device" right={<span className="hint-inline">live HR</span>}>
        {bluetoothSupported() ? (
          s.bleDevice ? (
            <div className="ble-card">
              <div className="ble-head">
                <span className="ble-icon">⌚</span>
                <div className="ble-body">
                  <div className="ble-name">{s.bleDevice.name}</div>
                  <div className="ble-status">
                    <span
                      className={`dot ${s.bleConnected ? "on" : ""}`}
                      style={{ background: s.bleConnected ? "#73976a" : "#9a8b7c" }}
                    />
                    {s.bleConnected ? "connected — heart rate streaming" : "disconnected"}
                  </div>
                </div>
                {s.bleConnected && (
                  <div className="ble-hr">
                    <span className="ble-hr-num">{s.bleHrNow ?? "—"}</span>
                    <span className="ble-hr-unit">bpm</span>
                  </div>
                )}
              </div>
              <div className="ble-actions">
                <button className="btn-ghost" onClick={() => s.disconnectBle()}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="ble-pair">
              <p className="hint" style={{ marginTop: 0 }}>
                Pair a real BLE fitness device (HR strap, watch or ring that exposes
                the standard Heart Rate service) — its live heart rate streams into the
                app and replaces the simulation. Chrome/Edge on a secure (HTTPS)
                origin required.
              </p>
              <button className="btn-start" onClick={() => void pairBle()} disabled={bleBusy}>
                {bleBusy ? "Scanning…" : "🔵 Pair a device"}
              </button>
              {bleMsg && <p className="hint" style={{ color: "var(--text-dim)" }}>{bleMsg}</p>}
            </div>
          )
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            Web Bluetooth isn&apos;t available in this browser — it needs Chrome or Edge
            on a secure (HTTPS) origin. Health Connect / HealthKit require the native
            app; this web build pairs devices over Bluetooth instead.
          </p>
        )}
      </Section>

      {/* Priority slots */}
      <Section title="Device slots" right={<span className="hint-inline">priority 1 &gt; 2 &gt; 3</span>}>
        <div className="slot-list">
          {byRank.map((d) => {
            const color = slotColor(d.priorityRank);
            return (
              <div key={d.id} className="slot" style={{ borderColor: `${color}55` }}>
                <div className="slot-rank" style={{ background: color }}>{d.priorityRank}</div>
                <div className="slot-body">
                  <div className="slot-name">
                    {d.name}
                    <span className={`conn ${d.connected ? "on" : ""}`}>{d.connected ? "connected" : "offline"}</span>
                  </div>
                  <div className="slot-meta">
                    <span className="src-badge">{SOURCE_LABEL[d.source]}</span>
                  </div>
                  <div className="slot-spec">
                    {d.specialty.map((m) => (
                      <span key={m} className="spec-chip">{metricDef(m).icon} {metricDef(m).label}</span>
                    ))}
                  </div>
                  <div className="slot-foot">
                    <div className="battery">
                      <div className="battery-track">
                        <div className="battery-fill" style={{ width: `${d.battery}%`, background: d.battery < 20 ? "#a63c3c" : color }} />
                      </div>
                      <span>{d.battery}%</span>
                    </div>
                    <span className="sync-ago">
                      {d.connected ? `synced ${d.lastSyncMin < 60 ? `${d.lastSyncMin}m` : `${Math.floor(d.lastSyncMin / 60)}h`} ago` : "no connection"}
                    </span>
                    <button className="link-btn" onClick={() => s.toggleDeviceConnection(d.id)}>
                      {d.connected ? "disconnect" : "reconnect"}
                    </button>
                  </div>
                </div>
                <div className="slot-arrows">
                  <button disabled={d.priorityRank <= 1} onClick={() => move(d.id, -1)}>▲</button>
                  <button disabled={d.priorityRank >= 3} onClick={() => move(d.id, 1)}>▼</button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="hint">
          Slot order is the default for every metric. Tap a metric below to override which device feeds it (Rule 2 — metric specialization).
        </p>
      </Section>

      {/* Cloud data sources — what the native Health-tab read actually pushed */}
      {s.wearableSync?.sources && (
        <Section title="Cloud data sources" right={<span className="hint-inline">what the phone pushed</span>}>
          {(() => {
            // Batch counts aggregate across each device's merged origins, so
            // a slot's number is its REAL total (e.g. Pixel Watch = Fit app +
            // Fitbit app), and only true legacy rows (flat pixel-watch pushes,
            // no-origin sleep) surface as orphans.
            const { counts, orphans } = canonicalSourceCounts(s.wearableSync!.sourceCounts ?? {});
            return (
              <>
                <div className="cloud-sources">
                  {s.wearableSync!.sources!.map((src) => (
                    <span key={src} className="src-chip">
                      {friendlySourceName(src)}
                      <span className="src-id">{shortOriginLabel(src)}</span>
                      <span className="src-count">{counts[src] ?? 0} batches</span>
                    </span>
                  ))}
                </div>
                {Object.keys(orphans).length > 0 && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    ⚠️ {Object.entries(orphans).map(([src, n]) => `${src} (${n})`).join(", ")} — legacy
                    rows from an earlier build. They&apos;re ignored (newer per-device rows supersede
                    them); re-read on the Health tab if you want the table clean.
                  </p>
                )}
              </>
            );
          })()}
          {s.wearableSync.sources.length < 2 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Only one device is writing to Health Connect right now — rythm only shows devices
              that actually push data. If your ring should appear here: open the ring&apos;s app
              (qring) → Settings → Health Connect → allow all data types, then tap <b>Read</b> on
              the Health tab. The ring becomes its own slot the moment its data lands in the cloud.
            </p>
          )}
        </Section>
      )}

      {/* Device truth report — "who's right: ring or watch?" */}
      {s.wearableSync?.truth && s.wearableSync.truth.length > 0 && (
        <Section title="Device truth report" right={<span className="hint-inline">who&apos;s right?</span>}>
          <p className="hint" style={{ marginTop: 0 }}>
            Both your devices measure some of the same things — here&apos;s how they compare and
            which one rythm trusts for each metric.
          </p>
          <div className="truth-list">
            {s.wearableSync.truth.map((t) => (
              <div key={t.metric} className="truth-card">
                <div className="truth-head">
                  <span className="truth-icon">{t.icon}</span>
                  <span className="truth-metric">{t.label}</span>
                  {t.agreePct !== null && (
                    <span className={`truth-agree ${t.agreePct >= 70 ? "good" : "warn"}`}>
                      {t.agreePct}% agree
                    </span>
                  )}
                </div>
                <div className="truth-devices">
                  {t.perDevice.map((d) => (
                    <div
                      key={d.id}
                      className={`truth-device ${d.id === t.recommendedId ? "rec" : ""}`}
                    >
                      <span className="truth-dev-name">
                        {d.name}
                        {d.id === t.recommendedId && <span className="crown">👑</span>}
                      </span>
                      <span className="truth-dev-val">
                        {Math.round(d.value * 10) / 10} {t.unit}
                        <span className="truth-dev-days">· {d.days}d</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="hint" style={{ margin: "6px 0 0" }}>{t.note}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Per-metric priority */}
      <Section title="Metric priority" right={<span className="hint-inline">tap to rotate</span>}>
        <div className="metric-rows">
          {METRICS.map((m) => {
            const order = effectiveOrder(m.key, s.devices);
            return (
              <button key={m.key} className="metric-row" onClick={() => s.cycleMetricPriority(m.key)}>
                <span className="metric-icon">{m.icon}</span>
                <div className="metric-info">
                  <div className="metric-label">{m.label}</div>
                  <div className="metric-order">
                    {order.map((id, i) => {
                      const dev = s.devices.find((d) => d.id === id)!;
                      return (
                        <span
                          key={id}
                          className={`order-chip ${i === 0 ? "first" : ""}`}
                          style={i === 0 ? { background: `${dev.color}22`, color: dev.color, borderColor: dev.color } : undefined}
                        >
                          {i + 1} · {dev.name.split(" ")[0]}
                          {i === 0 && <span className="crown">👑</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <span className="metric-arrow">↻</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Live merge feed */}
      <Section title="Live merge feed" right={<span className="hint-inline">rules 1–3 in action</span>}>
        <div className="feed-rows">
          {(Object.keys(s.feed) as MetricKey[]).map((k) => {
            const r = s.feed[k];
            const def = metricDef(k);
            if (!r) return null;
            const dev = s.devices.find((d) => d.id === r.deviceId);
            const color = dev?.color ?? "#9a8b7c";
            const ago = Math.max(0, s.simMin - r.sampleT);
            const fmtVal =
              k === "sleep"
                ? `${Math.floor(r.value / 60)}h ${r.value % 60}m`
                : k === "steps" || k === "activeEnergy"
                  ? Math.round(r.value).toLocaleString()
                  : k === "hrv" || k === "restingHR" || k === "skinTemp" || k === "spo2" || k === "respRate" || k === "hr"
                    ? `${r.value}${def.unit}`
                    : `${r.value}`;
            return (
              <button key={k} className="feed-row" onClick={() => setDetail(k)}>
                <span className="feed-icon">{def.icon}</span>
                <div className="feed-info">
                  <div className="feed-metric">{def.label}</div>
                  <div className="feed-source" style={{ color }}>
                    {r.fellBack > 0 ? "imputed from" : "from"} {r.deviceName}
                    <span className="feed-ago"> · {ago}m ago</span>
                  </div>
                </div>
                <span className="feed-value">{fmtVal}</span>
                <span className="feed-chev">›</span>
              </button>
            );
          })}
          {Object.keys(s.feed).filter((k) => s.feed[k as MetricKey]).length === 0 && (
            <p className="hint">No live readings yet — the simulation will stream shortly.</p>
          )}
        </div>
      </Section>

      {/* Rules */}
      <Section title="How merging works">
        <ol className="rules">
          <li>
            <b>Rule 1 · Time overlap</b> — when two devices report the same metric in the same window (e.g. HR at 02:15
            from both watch &amp; ring), the higher-priority device's sample wins.
          </li>
          <li>
            <b>Rule 2 · Metric specialization</b> — priority is per-metric: your ring can lead Sleep &amp; Skin Temp
            while your watch leads Steps &amp; Daytime HR.
          </li>
          <li>
            <b>Rule 3 · Imputation</b> — if the primary device drops its connection or dies, readings fall back to the
            next device in the order automatically (the feed shows “imputed from” when this happens).
          </li>
        </ol>
      </Section>

      {detail && <MetricDetail metric={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
