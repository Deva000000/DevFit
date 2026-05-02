/* DevFit Service Worker — v3.0.0
   Strategy (FIXED):
   - HTML pages: NETWORK-FIRST (no more stale UI / dead buttons after deploys)
   - Icons / manifest / static: cache-first
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate
   - Apps Script: network-only
*/

const VERSION = 'devfit-v3.3.0';
const APP_SHELL = 'devfit-shell-' + VERSION;
const RUNTIME = 'devfit-runtime-' + VERSION;

const SHELL_FILES = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.svg',
  './favicon.ico'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'];
const APPS_SCRIPT_HOST = 'script.google.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL)
      .then((cache) => cache.addAll(SHELL_FILES).catch((err) => console.warn('[SW] partial precache:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== APP_SHELL && k !== RUNTIME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Apps Script — never cache
  if (url.hostname.includes(APPS_SCRIPT_HOST)) return;

  // CDN — stale-while-revalidate
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.origin === self.location.origin) {
    // HTML navigation — NETWORK FIRST so deploys are instant
    const isHTML = req.mode === 'navigate' ||
                   req.destination === 'document' ||
                   url.pathname.endsWith('.html') ||
                   url.pathname.endsWith('/');
    if (isHTML) {
      event.respondWith(networkFirst(req));
      return;
    }
    // Static — cache-first
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      const cache = await caches.open(APP_SHELL);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    return new Response('Offline', { status: 503 });
  }
}

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
    return new Response('Offline', { status: 503 });
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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
