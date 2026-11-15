// Service Worker for Golden Palace POS (Offline-First Hardened v2)
const CACHE_NAME = 'golden-palace-pos-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle HTTP/HTTPS requests
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  const url = new URL(event.request.url);

  // Never serve cached API responses at SW layer (IndexedDB manages cached API payloads);
  // always return structured 503 offline marker when backend is unreachable.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            offline: true,
            error: 'Network connection unavailable. Queued for offline sync.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // SPA navigation: network-first with cached /index.html fallback so offline cold reload works
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone).catch(() => {}));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedHtml = (await caches.match('/index.html')) || (await caches.match('/'));
          return cachedHtml || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Static bundled assets & icons: cache-first with dynamic caching
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            event.request.method === 'GET' &&
            (url.pathname.endsWith('.js') ||
              url.pathname.endsWith('.css') ||
              url.pathname.endsWith('.svg') ||
              url.pathname.endsWith('.png') ||
              url.pathname.endsWith('.woff2') ||
              url.pathname.endsWith('.ico') ||
              url.pathname.endsWith('.webmanifest'))
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const fallback = await caches.match(event.request);
          return fallback || new Response('', { status: 404, statusText: 'Not Found' });
        });
    })
  );
});
