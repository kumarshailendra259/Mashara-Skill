// Mashara Check-In — minimal service worker for PWA Builder / Play Store eligibility.
// Strategy: network-first for HTML/API; cache-first for static icons/screenshots.
// Update CACHE_VERSION whenever shipping a new shell to bust old caches.

const CACHE_VERSION = "mashara-v1";
const STATIC_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Don't intercept API calls — always go to network so fresh data flows
  if (url.pathname.startsWith("/api/")) return;

  // Static assets (icons / screenshots / manifest) → cache-first
  if (url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/screenshots/") ||
      url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        return res;
      }))
    );
    return;
  }

  // Everything else (HTML / JS / CSS): network-first, fallback to cache when offline
  event.respondWith(
    fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
      return res;
    }).catch(() => caches.match(request))
  );
});
