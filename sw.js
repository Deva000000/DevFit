/* DevFit Service Worker — v1.0.0
   Strategy:
   - App shell (HTML, manifest, icons): cache-first, refresh in background
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate
   - Apps Script API calls: network-only (always fresh, never cached)
   - Auto-update: new SW takes control on next reload
*/

const VERSION = 'devfit-v2.1.0';
const APP_SHELL = 'devfit-shell-' + VERSION;
const RUNTIME = 'devfit-runtime-' + VERSION;

// Pre-cache the app shell (relative paths so it works under /DevFit/)
const SHELL_FILES = [
  './',
  './index.html',
  './login.html',
  './nutrition.html',
  './workouts.html',
  './settings.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// CDN origins we want to runtime-cache
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Apps Script — always go to network, never serve stale
const APPS_SCRIPT_HOST = 'script.google.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL)
      .then((cache) => cache.addAll(SHELL_FILES).catch((err) => {
        // Don't fail install if one file 404s — just log
        console.warn('[SW] Pre-cache partial failure:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== APP_SHELL && k !== RUNTIME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Apps Script — network-only (auth, sheets sync must be live)
  if (url.hostname.includes(APPS_SCRIPT_HOST)) {
    return; // let browser handle natively
  }

  // 2. CDN assets — stale-while-revalidate
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 3. Same-origin (app shell + icons) — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(APP_SHELL);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // Offline fallback for navigation
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Allow page to trigger immediate activation of new SW
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
