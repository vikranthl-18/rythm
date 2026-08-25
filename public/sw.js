// ---------------------------------------------------------------------------
// rythm — service worker (offline-first)
//
// The production build is a single self-contained index.html, so caching that
// one document makes the whole app work offline. Navigation requests fall
// back to the cached document; same-origin static assets are cache-first
// with background refresh. External requests (tiles, Google) are left alone —
// the app degrades gracefully when they're unreachable.
// ---------------------------------------------------------------------------

// Bump this for every release so stale caches are dropped on activate.
const CACHE = "rythm-v2";
const PRECACHE = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell: network-first so new releases show up on the first reload;
  // fall back to the cached document when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("./index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Other same-origin assets: cache-first with background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
