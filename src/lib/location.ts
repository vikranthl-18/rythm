// ---------------------------------------------------------------------------
// Location permission — rythm asks explicitly before touching the GPS, and
// never calls geolocation unless the user granted it. The browser's own
// permission prompt is the source of truth; we mirror it locally so the UI
// can show GPS On / Off / Not asked without re-prompting.
// ---------------------------------------------------------------------------

export type GpsPermission = "unknown" | "granted" | "denied" | "unsupported";

const KEY = "rythm-gps-permission";

export function gpsSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function loadGpsPermission(): GpsPermission {
  if (!gpsSupported()) return "unsupported";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {
    /* ignore */
  }
  return "unknown";
}

export function saveGpsPermission(p: GpsPermission): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
}

/** Check the browser's stored permission state without prompting. */
export async function queryGpsPermission(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  if (!gpsSupported()) return "unsupported";
  try {
    if (!navigator.permissions) return "prompt";
    const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return st.state as "granted" | "denied" | "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Trigger the browser's location prompt exactly once and resolve with whether
 * a fix was acquired. Never called unless the user tapped "Allow".
 */
export function askGpsPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!gpsSupported()) return resolve(false);
    try {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    } catch {
      resolve(false);
    }
  });
}
