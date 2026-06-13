// Optimus Gol Radarı - Service Worker
// Cache-first for static assets, network-first for API calls

const CACHE_NAME = 'optimus-gol-radar-v7';
const STATIC_CACHE = 'optimus-static-v7';
const API_CACHE = 'optimus-api-v6';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Only cache http/https URLs
function isCacheableUrl(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!isCacheableUrl(url)) return;

  // Skip cross-origin image requests that may fail (like FotMob)
  const isCrossOriginImage = url.origin !== self.location.origin &&
    (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i) ||
     url.hostname.includes('media.fotmob.com'));

  if (isCrossOriginImage) {
    // Network-only for cross-origin images - don't cache, don't intercept
    return;
  }

  // API calls: network-first with 10s timeout, then cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetchWithTimeout(request, 10000)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || new Response(JSON.stringify({ error: 'Offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && request.method === 'GET') {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
  }
});

function fetchWithTimeout(request, timeout) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    ),
  ]);
}
