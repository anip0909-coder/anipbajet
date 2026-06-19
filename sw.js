// Service worker untuk UrusDuit PWA
// Cache "app shell" sahaja (HTML/CSS/JS luaran) — data Google Sheets sentiasa fetch live dari internet,
// supaya angka kewangan yang dipaparkan tidak pernah lapuk/stale.

const CACHE_NAME = "urusduit-shell-v1";
const SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // JANGAN cache data Google Sheets / Apps Script — biar sentiasa live.
  if (url.includes("docs.google.com") || url.includes("script.google.com")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Untuk fail app shell & CDN (Tailwind/Chart.js/Font Awesome): cache-first, fallback ke network.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cache salinan respons CDN supaya boleh load semula bila offline/slow network.
          if (event.request.method === "GET" && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
