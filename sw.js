// UrusDuit PWA Service Worker
// Versi cache - tukar nombor ini untuk force update
const CACHE_NAME = 'urusduit-v1.0.0';
const STATIC_CACHE = 'urusduit-static-v1.0.0';
const DYNAMIC_CACHE = 'urusduit-dynamic-v1.0.0';

// Aset yang perlu dicache semasa install
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  // CDN resources (cached semasa runtime)
];

// CDN URLs yang perlu dicache
const CDN_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.tailwindcss.com',
];

// ==================== INSTALL EVENT ====================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing UrusDuit Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully!');
        return self.skipWaiting(); // Aktif serta-merta tanpa tunggu tab ditutup
      })
      .catch((error) => {
        console.error('[SW] Pre-caching failed:', error);
      })
  );
});

// ==================== ACTIVATE EVENT ====================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating UrusDuit Service Worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Old caches cleared. Service Worker active!');
        return self.clients.claim(); // Ambil kawalan semua tab serta-merta
      })
  );
});

// ==================== FETCH EVENT ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Jangan cache Google Sheets API requests (data mesti segar)
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('docs.google.com') ||
      url.hostname.includes('sheets.googleapis.com')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Tiada sambungan internet. Data Google Sheet tidak boleh dimuatkan.' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Strategi: Cache First (untuk aset statik & CDN)
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return dari cache, tapi update cache di background (stale-while-revalidate)
            const fetchPromise = fetch(request)
              .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                  const cacheName = isCDNRequest(url) ? DYNAMIC_CACHE : STATIC_CACHE;
                  caches.open(cacheName).then((cache) => {
                    cache.put(request, networkResponse.clone());
                  });
                }
                return networkResponse;
              })
              .catch(() => {}); // Silent fail untuk background update
            
            return cachedResponse;
          }

          // Tidak dalam cache - fetch dari network dan cache
          return fetch(request)
            .then((networkResponse) => {
              if (!networkResponse || networkResponse.status !== 200 || request.method !== 'GET') {
                return networkResponse;
              }

              const responseToCache = networkResponse.clone();
              const cacheName = isCDNRequest(url) ? DYNAMIC_CACHE : STATIC_CACHE;
              
              caches.open(cacheName)
                .then((cache) => {
                  cache.put(request, responseToCache);
                });

              return networkResponse;
            })
            .catch(() => {
              // Offline fallback untuk halaman HTML
              if (request.headers.get('accept').includes('text/html')) {
                return caches.match('./index.html');
              }
              // Fallback untuk gambar
              if (request.headers.get('accept').includes('image')) {
                return caches.match('./icons/icon-192x192.png');
              }
            });
        })
    );
  }
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  if (event.tag === 'sync-data') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // Hantar mesej ke semua klien untuk trigger sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'BACKGROUND_SYNC',
      message: 'Menyegerakkan data dengan Google Sheet...'
    });
  });
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'Notifikasi dari UrusDuit',
      icon: './icons/icon-192x192.png',
      badge: './icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: { dateOfArrival: Date.now(), primaryKey: 1 },
      actions: [
        { action: 'open', title: 'Buka App' },
        { action: 'dismiss', title: 'Tutup' }
      ]
    };
    event.waitUntil(
      self.registration.showNotification(data.title || 'UrusDuit', options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('./')
    );
  }
});

// ==================== MESSAGE HANDLER ====================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map(name => caches.delete(name))))
    );
  }
});

// ==================== HELPER FUNCTIONS ====================
function isCDNRequest(url) {
  const cdnHosts = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'cdn.tailwindcss.com'
  ];
  return cdnHosts.some(host => url.hostname.includes(host));
}
