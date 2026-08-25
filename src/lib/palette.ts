// ---------------------------------------------------------------------------
// Custom app colors. The design system (theme.css) defines the whole palette
// as CSS variables: the PRIMARY accent family (--accent, --accent-08…50,
// --btn-1/2) and the SECONDARY sage family (--green, --green-2, --sage-08…30).
// When the user picks custom colors these variables are overridden on the
// document root, so every component that uses them re-themes instantly —
// light and dark modes keep their own surfaces/text but share the chosen hue.
// ---------------------------------------------------------------------------

const ACCENT_ALPHAS = [0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.26, 0.28, 0.3, 0.35, 0.36, 0.4, 0.5];
const SAGE_ALPHAS = [0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.3];

/** "#rrggbb" (or 3-digit) → rgba() string. Falls back to black on garbage. */
export function hexToRgba(hex: string, alpha: number): string {
  const full = normalizeHex(hex);
  if (!full) return `rgba(0, 0, 0, ${alpha})`;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten (factor > 0) or darken (factor < 0) a hex color. */
export function shadeHex(hex: string, factor: number): string {
  const full = normalizeHex(hex);
  if (!full) return hex;
  const n = parseInt(full, 16);
  const shift = (v: number) =>
    Math.max(0, Math.min(255, Math.round(factor >= 0 ? v + (255 - v) * factor : v * (1 + factor))));
  const r = shift((n >> 16) & 255);
  const g = shift((n >> 8) & 255);
  const b = shift(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeHex(hex: string): string | null {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) return h.split("").map((c) => c + c).join("");
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  return null;
}

/** alpha-suffixed var name, e.g. 0.08 → "--accent-08". */
function alphaVar(base: string, alpha: number): string {
  return `${base}-${String(Math.round(alpha * 100)).padStart(2, "0")}`;
}

/**
 * Apply (or clear) the user's custom colors. `accent`/`green` are hex strings
 * or null for "use the theme default". Overrides are set as inline styles on
 * <html>, so they win over theme.css and survive theme switches.
 */
export function applyCustomColors(accent: string | null, green: string | null): void {
  const root = document.documentElement;
  const setVar = (name: string, value: string | null) => {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  };

  if (accent) {
    setVar("--accent", accent);
    setVar("--btn-1", accent);
    setVar("--btn-2", shadeHex(accent, -0.14));
    for (const a of ACCENT_ALPHAS) setVar(alphaVar("--accent", a), hexToRgba(accent, a));
  } else {
    setVar("--accent", null);
    setVar("--btn-1", null);
    setVar("--btn-2", null);
    for (const a of ACCENT_ALPHAS) setVar(alphaVar("--accent", a), null);
  }

  if (green) {
    setVar("--green", green);
    setVar("--green-2", shadeHex(green, -0.18));
    for (const a of SAGE_ALPHAS) setVar(alphaVar("--sage", a), hexToRgba(green, a));
  } else {
    setVar("--green", null);
    setVar("--green-2", null);
    for (const a of SAGE_ALPHAS) setVar(alphaVar("--sage", a), null);
  }
}
