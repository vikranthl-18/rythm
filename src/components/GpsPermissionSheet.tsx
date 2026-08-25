import { useState } from "react";
import { useStore } from "../store";

export default function GpsPermissionSheet() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const allow = async () => {
    setBusy(true);
    const r = await s.requestGpsPermission();
    setBusy(false);
    if (r.ok) return; // sheet unmounts — permission granted
    if (r.blocked) setResult("Location is blocked in your browser. Allow it in the site settings (padlock icon → Location), then tap Allow again.");
    else setResult("Location wasn't granted — routes will use simulated GPS. You can enable it anytime in Settings → Location.");
  };

  return (
    <div className="sheet-overlay">
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">📍</div>
          <h2>GPS routes</h2>
        </div>
        <div className="sheet-body">
          <p className="hint" style={{ marginTop: 0 }}>
            rythm uses your location <b>only while you record outdoor workouts</b> — runs,
            rides and hikes — to draw your route on the map. Your location is never stored on
            a server and stays on your device.
          </p>
          <button className="btn-start" disabled={busy} onClick={allow}>
            {busy ? "Waiting for your browser…" : "Allow location"}
          </button>
          <button
            className="btn-ghost"
            style={{ marginTop: 8 }}
            onClick={() => s.setGpsPermission("denied")}
          >
            Not now — simulate GPS
          </button>
          {result && <p className="hint">{result}</p>}
          <p className="hint center" style={{ marginTop: 8 }}>
            You can change this anytime in Settings → Location.
          </p>
        </div>
      </div>
    </div>
  );
}
