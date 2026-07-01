// Optimus Gol Radarı - Service Worker
// Cache-first for static assets, network-first for API calls

const CACHE_NAME = 'optimus-gol-radar-v8';
const STATIC_CACHE = 'optimus-static-v8';
const API_CACHE = 'optimus-api-v7';

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

  // Admin pages + Next.js server-rendered routes: network-only.
  // Auth-gated / personalized content (e.g. /admin/pnl) MUST NOT be
  // cached — serving stale HTML after a logout would leak the next
  // user's session. Same goes for all HTML responses.
  if (
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/api/admin/') ||
    (request.mode === 'navigate' && request.method === 'GET')
  ) {
    // Network-only, but resolve gracefully on failure (e.g. offline)
    // so the user sees Next.js's own error page instead of an
    // unhandled promise rejection.
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><html><body><h1>Offline</h1><p>Bu sayfa çevrimdışı kullanılamaz.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )),
    );
    return;
  }

  // API calls: network-first with 10s timeout, then cache (GET only)
  if (url.pathname.startsWith('/api/')) {
    // POST requests: network-only, never cache
    if (request.method !== 'GET') {
      return; // Let browser handle normally
    }

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
      }).catch(() => new Response('', { status: 503 }))
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
