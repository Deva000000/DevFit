/* DevFit Service Worker — v4.96.2
   - Shell assets: one content-verified release, served from its own cache.
   - Installation fails closed if ANY required asset is missing or mismatched.
   - Switching a release is deliberate and requires other DevFit tabs to close.
   - Non-shell pages: network-first. Non-shell images: cache-first.
   - CDN assets (Chart.js, jsPDF, fonts): stale-while-revalidate.
   - /api/*: network-only (never cached).
*/

const VERSION = 'devfit-v4.96.2';

const SHELL_FILES = [
  // ── Core HTML pages — precached so the whole app works offline ──────
  './login.html',
  './index.html',
  './nutrition.html',
  './workouts.html',
  './settings.html',
  './admin.html',
  './landing.html',
  './pricing.html',
  './privacy.html',
  './terms.html',
  // ── Manifest + icons ────────────────────────────────────────────────
  './manifest.json',
  './icon-touch.png',
  './icon-192.png',
  './icon-512.png',
  './icon-1024.png',
  './logo-header.png',
  './logo-white.png',
  './devfit-coaching-poster.png',
  './favicon.svg',
  './favicon.ico',
  // ── App JS / CSS ─────────────────────────────────────────────────────
  './devfit-db.js',
  './devfit-auth.js',
  './input-limits.js',
  './receipt-amount.js',
  './login-install.js',
  './food-search-client.js',
  './devfit-errorlog.js',
  './pwa-update.js',
  './foods-local.js',
  './foods-bulk.js',
  './scoring.js',
  './progress-model.js',
  './report-engine.js',
  './devfit-pdf.js',
  './pdf-loader.js',
  './theme.css',
  './theme.js'
];

// Generated after source edits. An incomplete/mixed deploy cannot install.
// RELEASE_HASHES_START
const SHELL_HASHES = {
  "./login.html": "ac20c415ecc0dd9b77bdc14f0602880afde5c976744bbb44994de44aff70090d",
  "./index.html": "3dc47eb62017123ce0b95c0f923426d4e87836960d96a43086b5d24f67192c66",
  "./nutrition.html": "ee697ac9fb1813467fded11893cd87c9bef12b8f6f1e4ca1a6e6be362e4be4c1",
  "./workouts.html": "2c005f4decf7a05ecfbf600bcbde31f3ae13eaae8fdb15e77f4a9a0177f28b22",
  "./settings.html": "754924ffb9deb9eb1248c1ec536a2354ade75369d17bf7e610aba53800eb28b4",
  "./admin.html": "60bfb9e291ce60484ae0b2235b1b4118d542bf6673bb1944ff7e11bc47ebd482",
  "./landing.html": "dc773d097643a8c435cbe99d0db99dc0ab69aa415e60dff152190f2744ddf7b4",
  "./pricing.html": "2861c7fc61b1afe6719a818f8d0eaea0f9f6e7830645a9a51d375eb88286f835",
  "./privacy.html": "bcf0281be12f53d336e081a4a5266954c1afbd0a436ddb86194fada58acc886a",
  "./terms.html": "eb2409661eafb346a18bed8639103123093d69b0fef4304edba648f85ed46d90",
  "./manifest.json": "d8c0d8d5ca8e140ac96b5f41c91236be60e484b9832ab940ddb48ec52a1b2b3c",
  "./icon-touch.png": "119f499d0ff0ddaa02925e63a85aff7847581e6607abcc616b759c1e95a5e074",
  "./icon-192.png": "f3dee142ca2cf9c573f1a6952f0139bc9d67610289c0e520c495f4928e5d9035",
  "./icon-512.png": "3a93dd49ddb9b2a6049ff8b41828c51adca7f2d6995bf22e56c477f4e8dfb152",
  "./icon-1024.png": "bd381f03210d7dfeb8cb0fa88edc16aa4205900b93acb3fcf2df4cc225deb69a",
  "./logo-header.png": "4d5d5419e6491988dd18926d1984745fa6aee5b12375ce59fcbf05f6071e3c81",
  "./logo-white.png": "f00ce5f5601efb53416e3595d9f7a982ab8d0b3eca07a2a10e130aee5088c4a8",
  "./devfit-coaching-poster.png": "f9d6420642f3f962d9cb54ee2130054605efcab1f855d2e6aed04f7ad8d86568",
  "./favicon.svg": "8a47ecd6bac6f8fb0edd2002698948eaacc7ea002da896e94bf56b6937f3e461",
  "./favicon.ico": "91fa6dbfe049c74ea62e0dcdf3326b40e05481eb3928541ae946385c2510520b",
  "./devfit-db.js": "b9c3897a85dbec64db8eee5e9956cba9436da2786f4c7012613b94d9a86d7fdc",
  "./devfit-auth.js": "eabd6ad0065c2ad0d3f74a5446d1e0707daa9afef7c0e01e48e10893b191c648",
  "./input-limits.js": "05b91043997e9c813f4390115c6d1db37f30e97a398855faabb8b6cd58b7521b",
  "./receipt-amount.js": "46facc92dc8e931a8b51c17f6f72a2483f455dbc438a442f5f703fe6a04e40ec",
  "./login-install.js": "e604908a18f3a92abb5a3b60b036d3b831bd10e73ae954ee158170f6c11bda6e",
  "./food-search-client.js": "2b4277db5cfbbe5ae557f5bbcb38aa7deeb62f9929cf94ef380b00d1cfb770f8",
  "./devfit-errorlog.js": "821fbe57a663f8ab2f3b2eb587203da6604cd6b938a4379dffa0c2e491e50f24",
  "./pwa-update.js": "f33609bc1541a7ebe5678ae8b13f092a0826378a2e21d896a2c635cbb636b076",
  "./foods-local.js": "5cbc83761e593f291afc0f420fd3d14b7a507c9effe31fa8f49b98c86e55df54",
  "./foods-bulk.js": "938c82feb73b34349b58b21cdc01e00501aad4a26b68b84222299ac5683c241f",
  "./scoring.js": "358935ba7ce8d349dea4678e1c500e83c4b34b1f0b9979bd63eabf6382eda89c",
  "./progress-model.js": "5ea50691b1dbf62cafab657074928b8d086893f919175c2a0d28ec9ca4487eb1",
  "./report-engine.js": "bf996dac117eba05986907dab6de918e77a8b6e8d541db196a374223ff1f96b5",
  "./devfit-pdf.js": "893107adfa0730eb3c186c8b5e157bd748d562ef38e7b8553f67ab0d8c938df9",
  "./pdf-loader.js": "6d7b1164d8a62b72edcc35676a7aa9926befbb72b76d33fa3c69ddc76f7b7518",
  "./theme.css": "e63bd16a33952266e2479f34c746df45b4fdd25ca0f72b35f1288a951746f0fc",
  "./theme.js": "e3f8156550f06bc900432207523dc0ef2b0e7cbc75f95b1939e1d739910688ef"
};
const RELEASE_ID = "586e0642a94da1165a6bcc2cdaf5baa9bfe388fd0f5d359169faef4fdcc4248d";
// RELEASE_HASHES_END

// Keep this list aligned with CSP connect-src: intercepted CDN requests are
// fetched by the worker, so script-src alone is not enough to let them through.
const CDN_HOSTS = ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','unpkg.com'];
// Content identity, not merely a human version label, owns each cache. A future
// forgotten version bump cannot write new assets into the currently active cache.
const APP_SHELL = 'devfit-shell-' + VERSION + '-' + RELEASE_ID;
const RUNTIME = 'devfit-runtime-' + VERSION + '-' + RELEASE_ID;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL)
      .then((cache) => Promise.all(SHELL_FILES.map(async f => {
        const r = await fetch(f, { cache: 'no-store' });
        if (!r || !r.ok || r.redirected) throw new Error('Release asset unavailable: ' + f);
        const bytes = /\.(html|js|css|json|svg)$/.test(f)
          ? new TextEncoder().encode((await r.clone().text()).replace(/\r\n/g,'\n'))
          : await r.clone().arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
        if (!SHELL_HASHES[f] || hash !== SHELL_HASHES[f]) throw new Error('Release asset mismatch: ' + f);
        await cache.put(f, r);
      })))
      // On an update, remain waiting until the client deliberately chooses the
      // update banner. First installs activate normally because no worker exists.
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

  // Serverless API routes (e.g. /api/usda) — always network, never cache
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // CDN — stale-while-revalidate
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.origin === self.location.origin) {
    const path = url.pathname;
    // Known shell files always come from the verified release cache. Only
    // unknown documents/code use network-first; they are not core app modules.
    const isDoc = req.mode === 'navigate' || req.destination === 'document' ||
                  path.endsWith('.html') || path.endsWith('/');
    const isBigFoodDb = /foods-(local|bulk)\.js$/.test(path);
    const isAppCode = /\.(js|css)$/.test(path) && !isBigFoodDb;

    const canonical = path === '/' ? './index.html' : '.' + path;
    if (SHELL_FILES.includes(canonical)) { event.respondWith(releaseAsset(req, canonical)); return; }
    if (isDoc || isAppCode) { event.respondWith(networkFirst(req)); return; }
    // Everything else (food DBs, icons, images, manifest) — cache-first.
    event.respondWith(cacheFirst(req));
  }
});

async function releaseAsset(req, canonical) {
  const cache = await caches.open(APP_SHELL);
  const cached = await cache.match(canonical);
  // Never substitute an asset from another release, even when online.
  if (cached) return cached;
  return new Response(req.mode === 'navigate' ? OFFLINE_PAGE : 'DevFit release is incomplete. Reopen while online.', {
    status: 503, headers: { 'Content-Type': req.mode === 'navigate' ? 'text/html; charset=utf-8' : 'text/plain' }
  });
}

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
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Switching one open tab must not replace dependencies under another tab
    // that is still editing the old release.
    if (tabs.length > 1) {
      if (event.source) event.source.postMessage({ type: 'DEVFIT_UPDATE_BLOCKED' });
      return;
    }
    await self.skipWaiting();
  })());
});
