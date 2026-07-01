/**
 * UrusDuit Service Worker
 * Strategi:
 *   - App Shell (HTML, CSS, Font, Icons) → Cache First
 *   - Google Sheet CSV / Apps Script   → Network First (dengan fallback cache)
 *   - Aset pihak ketiga (CDN)          → Stale-While-Revalidate
 */

const CACHE_NAME    = 'urusduit-v1.0.0';
const OFFLINE_URL   = 'offline.html';

// Senarai aset utama app shell yang dicache semasa install
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
  './offline.html'
];

// Prefix URL yang layak untuk cache (CDN aset pihak ketiga)
const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net'
];

// URL yang tidak patut di-cache (Google Sheets API, Apps Script)
const BYPASS_PATTERNS = [
  'script.google.com',
  'docs.google.com/spreadsheets',
  'googleapis.com/identitytoolkit'
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.filter(url => !url.includes('offline')).concat(['./offline.html'])))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install cache error (non-fatal):', err))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.startsWith('chrome-extension://')) return;

  // 1. Google Sheets / Apps Script — Network Only (jangan cache, data sentiasa perlu segar)
  const isBypass = BYPASS_PATTERNS.some(p => url.includes(p));
  if (isBypass) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ status: 'error', message: 'Tiada sambungan internet.' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 2. CDN aset (fonts, icons, tailwind, chart.js) — Stale While Revalidate
  const isCDN = CDN_ORIGINS.some(origin => url.startsWith(origin));
  if (isCDN) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. App Shell (HTML, manifest, icons) — Cache First, fallback offline page
  event.respondWith(cacheFirst(request));
});

// ── STRATEGY: Cache First ─────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline — return cached offline page for navigate requests
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('./offline.html');
      return offlinePage || new Response('<h1>Tiada Sambungan</h1>', { headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── STRATEGY: Stale While Revalidate ─────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || await networkFetch ||
    new Response('', { status: 503 });
}

// ── BACKGROUND SYNC (optional) ───────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
