/* DevFit Service Worker — v3.0.0
   Strategy (FIXED):
   - HTML pages: NETWORK-FIRST (no more stale UI / dead buttons after deploys)
   - Icons / manifest / static: cache-first
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate
   - Apps Script: network-only
*/

const VERSION = 'devfit-v4.28.0';
const APP_SHELL = 'devfit-shell-' + VERSION;
const RUNTIME = 'devfit-runtime-' + VERSION;

const SHELL_FILES = [
  './manifest.json',
  './icon-touch.png',
  './icon-192.png',
  './icon-512.png',
  './icon-1024.png',
  './logo-header.png',
  './logo-white.png',
  './favicon.svg',
  './favicon.ico',
  './devfit-db.js',
  './pwa-update.js',
  './foods-local.js',
  './scoring.js',
  './theme.css',
  './theme.js'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','zngberygrzpkhiqrrzwj.supabase.co'];
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

// ---------- DAILY REMINDERS ----------
// Periodic Background Sync fires this ~once a day on installed PWAs (Chrome/
// Android). iOS/desktop browsers that don't support it simply won't — the
// in-app fallback on index.html covers those when the app is opened.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'devfit-daily-reminder') event.waitUntil(showDailyReminder());
});

async function showDailyReminder() {
  // At most one reminder per calendar day
  try {
    const today = new Date().toISOString().slice(0, 10);
    const cache = await caches.open('devfit-reminder-state');
    const last = await cache.match('last-reminder');
    if (last && (await last.text()) === today) return;
    await cache.put('last-reminder', new Response(today));
  } catch (e) {}
  return self.registration.showNotification('DevFit', {
    body: "Don't break the chain — log your weight, steps and sleep today.",
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'devfit-daily',
    data: { url: './index.html' }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.includes('index.html') && 'focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
