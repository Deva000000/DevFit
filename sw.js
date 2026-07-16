/* DevFit Service Worker — v3.2.0
   Strategy:
   - HTML pages: NETWORK-FIRST with cache fallback (instant offline from any page)
   - All core HTML precached at install → app works offline after first SW install
   - Icons / manifest / static: cache-first
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate
   - Apps Script / /api/*: network-only (never cached)
*/

const VERSION = 'devfit-v4.55.1';
const APP_SHELL = 'devfit-shell-' + VERSION;
const RUNTIME = 'devfit-runtime-' + VERSION;

const SHELL_FILES = [
  // ── Core HTML pages — precached so the whole app works offline ──────
  './login.html',
  './index.html',
  './nutrition.html',
  './workouts.html',
  './settings.html',
  './landing.html',
  // ── Manifest + icons ────────────────────────────────────────────────
  './manifest.json',
  './icon-touch.png',
  './icon-192.png',
  './icon-512.png',
  './icon-1024.png',
  './logo-header.png',
  './logo-white.png',
  './favicon.svg',
  './favicon.ico',
  // ── App JS / CSS ─────────────────────────────────────────────────────
  './devfit-db.js',
  './devfit-auth.js',
  './pwa-update.js',
  './foods-local.js',
  './foods-bulk.js',
  './scoring.js',
  './theme.css',
  './theme.js'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','zngberygrzpkhiqrrzwj.supabase.co'];
const APPS_SCRIPT_HOST = 'script.google.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL)
      // Cache each file independently — addAll() is atomic, so one 404 would
      // wipe the WHOLE offline cache. Individual puts keep offline working
      // even if a single asset is missing/renamed.
      .then((cache) => Promise.allSettled(
        SHELL_FILES.map((f) =>
          fetch(f, { cache: 'no-store' })
            .then((r) => { if (r && r.ok) return cache.put(f, r); throw new Error(r && r.status); })
            .catch((e) => console.warn('[SW] precache skip', f, String(e)))
        )
      ))
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

  // Serverless API routes (e.g. /api/usda) — always network, never cache
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

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
