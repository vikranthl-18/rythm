// ---------------------------------------------------------------------------
// Map tiles — configurable via VITE_TILE_URL (any XYZ template), defaulting
// to OpenStreetMap, with an automatic fallback to CARTO Positron if tiles
// fail (blocked provider, rate limit, offline tile CDN). The Leaflet layer
// calls `fallbackTileUrl()` itself so the swap is invisible to the app.
// ---------------------------------------------------------------------------

export function tileUrl(): string {
  const t = ((import.meta.env.VITE_TILE_URL as string | undefined) ?? "").trim();
  return t || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}

export function tileAttribution(): string {
  const custom = ((import.meta.env.VITE_TILE_URL as string | undefined) ?? "").trim();
  if (custom) return "";
  return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
}

export function fallbackTileUrl(): string {
  return "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
}

export function fallbackAttribution(): string {
  return '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
}
