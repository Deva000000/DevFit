/* DevFit Service Worker — v4.0.0
   Strategy (atomic updates — no stale code can ever mix with fresh HTML):
   - HTML pages + app logic (.js/.css): NETWORK-FIRST with cache fallback, so every
     online load gets a consistent, up-to-date set. This is what prevents the
     "new page + stale script = broken feature" class of bugs after a deploy.
   - Big food databases (foods-local/bulk.js): cache-first (versioned via ?v=), to
     save mobile data. Offline, ignoreSearch resolves ?v= URLs to the precached file.
   - Icons / manifest / images: cache-first.
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate.
   - Apps Script / /api/*: network-only (never cached).
*/

const VERSION = 'devfit-v4.67.0';
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
  './pricing.html',
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
  './devfit-errorlog.js',
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
    const path = url.pathname;
    // NETWORK-FIRST for HTML + all app logic (.js/.css) so a deploy is ATOMIC:
    // you can never end up with fresh HTML wired to stale JS (the exact failure
    // that stuck the diet page after an update). Offline falls back to cache.
    // The big, rarely-changing food databases stay CACHE-FIRST to save mobile data
    // (they're versioned via ?v= and busted on change).
    const isDoc = req.mode === 'navigate' || req.destination === 'document' ||
                  path.endsWith('.html') || path.endsWith('/');
    const isBigFoodDb = /foods-(local|bulk)\.js$/.test(path);
    const isAppCode = /\.(js|css)$/.test(path) && !isBigFoodDb;

    if (isDoc || isAppCode) { event.respondWith(networkFirst(req)); return; }
    // Everything else (food DBs, icons, images, manifest) — cache-first.
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(APP_SHELL);
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) { cache.put(req, fresh.clone()); return fresh; }
    // Non-OK (e.g. a bad deploy briefly 404s) → prefer last-known-good cache.
    const cached = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
    return cached || fresh;
  } catch (e) {
    const cached = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      // Only ever stand in for the app ROOT. Serving index.html in place of a
      // *named* page silently drops the user on a different screen — that is
      // exactly why "Unlock Pro" read as doing nothing / bouncing to the home
      // page: pricing.html wasn't precached, so every offline tap on the CTA
      // rendered the Progress page under a pricing.html URL. A named page we
      // genuinely don't have must say so, not impersonate another page.
      const p = new URL(req.url).pathname;
      if (p === '/' || /\/(index\.html)?$/.test(p)) {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return new Response('Offline', { status: 503 });
  }
}

const OFFLINE_PAGE = `<!DOCTYPE html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DevFit — Offline</title>
<style>body{font-family:'DM Sans',system-ui,sans-serif;background:#0d0d10;color:#e8e8ea;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
.b{font-size:22px;font-weight:800;letter-spacing:.02em}.b i{color:#cc0000;font-style:italic}
p{color:#9a9aa2;font-size:14px;line-height:1.6;margin:12px 0 22px;max-width:320px}
a{display:inline-block;background:#cc0000;color:#fff;text-decoration:none;font-weight:700;
font-size:14px;padding:12px 26px;border-radius:22px}</style>
<div><div class="b">DEV<i>FIT</i></div>
<p>You're offline, so this page can't load right now. Your logged data is safe on this device.</p>
<a href="./index.html">Back to DevFit</a></div>`;

async function cacheFirst(req) {
  const cache = await caches.open(APP_SHELL);
  // Match the exact URL first, then ignore ?v= so versioned assets still resolve
  // offline against the precached base file.
  const cached = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
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
