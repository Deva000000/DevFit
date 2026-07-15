/* DevFit — client auth (Layer 1)
 * Single source of truth for the login gate + tier, shared by every app page.
 *
 * Security model (be honest about it):
 *  - The server issues a SIGNED token (devfit_token). On each page load we send
 *    it to /api/verify, which checks the signature + re-reads the subscriber row
 *    and returns the authoritative tier. A hand-faked localStorage session has
 *    no valid token, so verify returns approved:false and we bounce to login.
 *  - Gating still runs in the browser (isPro), so a determined user can override
 *    it live in the console for ONE session. That resets on reload and is the
 *    Layer-3 tradeoff we deliberately skipped. Layer 1 stops persistent forgery.
 *
 * Rollout safety:
 *  - MODE 'transition' (default): if /api/verify is missing (501) or the network
 *    is down, we KEEP the cached session. Deploy this before setting env vars and
 *    nobody is locked out.
 *  - MODE 'strict': once env vars are live and tested, flip DEVFIT_AUTH_STRICT to
 *    true (below). Then an invalid/absent token online forces re-login.
 */
(function (global) {
  'use strict';

  var VERIFY_API = '/api/verify';
  var SESSION_API = '/api/session';
  var STRICT = true; // backend live + verified — forged/absent tokens are now rejected

  function getUser() {
    try { return JSON.parse(localStorage.getItem('devfit_user') || '{}'); } catch (e) { return {}; }
  }
  function getToken() { try { return localStorage.getItem('devfit_token') || ''; } catch (e) { return ''; } }

  // Stable per-device id so the trainer can see how many devices an email uses
  // (two phones, phone+tablet+laptop). Persists in localStorage; regenerated only
  // if storage is wiped. Data itself is shared across devices via email cloud-sync.
  function deviceId() {
    try {
      var d = localStorage.getItem('devfit_device_id');
      if (!d) {
        d = (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(16).slice(2));
        localStorage.setItem('devfit_device_id', d);
      }
      return d;
    } catch (e) { return 'unknown'; }
  }

  function setSession(u, token) {
    try {
      localStorage.setItem('devfit_user', JSON.stringify(u));
      if (token) localStorage.setItem('devfit_token', token);
      localStorage.setItem('devfit_lastVerified', String(Date.now()));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem('devfit_user');
      localStorage.removeItem('devfit_token');
      localStorage.removeItem('devfit_lastVerified');
    } catch (e) {}
  }

  // ── Per-account local data isolation ──────────────────────────────────────
  // The cloud (Supabase devfit_data) is keyed by email, but the LOCAL cache uses
  // global keys. Without a guard, logging out and back in as a different email on
  // the same device leaves the previous person's program/diet/workout data in
  // localStorage — the app then shows it AND syncs it up to the new email's cloud
  // row, cross-contaminating both accounts. enforceDataOwner() binds the local
  // cache to exactly one email at a time and wipes it clean on an account switch.
  var DATA_KEYS = [
    'progressLog2', 'devfitNutritionV2', 'devfitNutritionV1', 'devfitTrainingV1',
    'devfit_cloud_ts_progress', 'devfit_cloud_ts_nutrition', 'devfit_cloud_ts_workouts',
    'devfit_local_ts_progress', 'devfit_local_ts_nutrition', 'devfit_local_ts_workouts',
    'devfit_freeWeekKey', 'devfit_displayName',
    'devfit_cardioSessGoal', 'devfit_cardioGoalKm', 'devfit_trendRange', 'devfit_progSection'
  ];

  function wipeLocalData() {
    try { DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }

  // Snapshot the three core data blobs under an email-scoped key before wiping, so
  // an offline account-switch never destroys unsynced edits — they can be recovered
  // from devfit_backup_<email> if that user logs back in on this same device.
  function snapshotFor(email) {
    if (!email) return;
    try {
      var snap = {
        progressLog2: localStorage.getItem('progressLog2'),
        devfitNutritionV2: localStorage.getItem('devfitNutritionV2'),
        devfitTrainingV1: localStorage.getItem('devfitTrainingV1'),
        ts: Date.now()
      };
      if (snap.progressLog2 || snap.devfitNutritionV2 || snap.devfitTrainingV1) {
        localStorage.setItem('devfit_backup_' + email, JSON.stringify(snap));
      }
    } catch (e) {}
  }

  function currentEmail() { return (getUser().email || '').trim().toLowerCase(); }

  function enforceDataOwner() {
    try {
      var current = currentEmail();
      if (!current) return;                     // not logged in — gate() redirects
      var owner = (localStorage.getItem('devfit_data_owner') || '').trim().toLowerCase();
      if (!owner) { localStorage.setItem('devfit_data_owner', current); return; } // adopt existing cache
      if (owner === current) return;            // same account — nothing to do
      // A different account owns the local cache. Preserve it, then wipe clean so
      // the newly logged-in email starts from its own cloud data (or fresh).
      snapshotFor(owner);
      wipeLocalData();
      localStorage.setItem('devfit_data_owner', current);
    } catch (e) {}
  }

  // Run the guard as early as possible — this IIFE executes before any page's
  // data-reading code, so the cache is already clean by the time the app reads it.
  enforceDataOwner();

  // Tier as the client sees it — trusts the last verified value, but still
  // auto-reverts to Free the moment the paid period ends (offline-safe).
  function getUserTier() {
    try {
      var u = getUser();
      var t = (u.tier || 'pro').toLowerCase();
      if (t === 'pro') {
        var today = new Date(); today.setHours(0, 0, 0, 0);
        // Not started yet → Free until the plan's start date.
        if (u.startDate) {
          var st = new Date(u.startDate);
          if (!isNaN(st)) { st.setHours(0, 0, 0, 0); if (st > today) t = 'free'; }
        }
        // Past the end (expiry) day → Free.
        if (t === 'pro' && u.expiry) {
          var exp = new Date(u.expiry);
          if (!isNaN(exp)) {
            var end = new Date(exp); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
            if (end <= today) t = 'free';
          }
        }
      }
      return t;
    } catch (e) { return 'pro'; }
  }
  function isPro() { return getUserTier() === 'pro'; }

  // Exchange a verified identity token (Supabase/Google) for a signed session.
  // Returns { approved, ... } or throws on transport error.
  async function startSession(provider, providerToken, name) {
    var res = await fetch(SESSION_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ provider: provider, token: providerToken, deviceId: deviceId() })
    });
    if (res.status === 501) return { notConfigured: true };
    var data = await res.json();
    if (data && data.approved) {
      setSession({
        email: data.email, name: data.name || name || '', approved: true,
        plan: data.plan || '', expiry: data.expiry || '', startDate: data.startDate || '',
        tier: (data.tier || 'pro').toLowerCase()
      }, data.token);
    }
    return data;
  }

  // Re-verify the current session against the server. Updates the cached tier.
  // Returns 'ok' | 'reload' | 'kick' | 'skip' (skip = offline/not-configured).
  async function reverify() {
    var u = getUser();
    if (!u.email) return 'kick';
    try {
      var res = await fetch(VERIFY_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ token: getToken(), email: u.email, deviceId: deviceId() })
      });
      if (res.status === 501) return 'skip'; // not configured yet → trust cache
      var data = await res.json();
      if (data && data.approved) {
        var oldTier = (u.tier || '').toLowerCase();
        var newTier = (data.tier || 'pro').toLowerCase();
        u.tier = newTier;
        if (data.expiry !== undefined) u.expiry = data.expiry;
        if (data.startDate) u.startDate = data.startDate;
        if (data.plan) u.plan = data.plan;
        if (data.name) u.name = data.name;
        setSession(u, data.token);
        return (oldTier && oldTier !== newTier) ? 'reload' : 'ok';
      }
      // Server says this session is invalid/revoked.
      return STRICT ? 'kick' : 'skip';
    } catch (e) {
      return 'skip'; // offline → keep cached session (PWA grace)
    }
  }

  // Page entry point. Redirects to login when there's no session, otherwise
  // reverifies in the background and applies tier changes.
  function gate(onReady) {
    var u = getUser();
    if (!u.email) { global.location.href = 'login.html'; return; }
    var initialTier = getUserTier();
    reverify().then(function (r) {
      if (r === 'kick') { clearSession(); global.location.href = 'login.html'; return; }
      // Reload whenever the effective tier changed vs what the page rendered with,
      // so gates re-apply from a clean state instead of double-binding listeners.
      if (r === 'reload' || getUserTier() !== initialTier) {
        setTimeout(function () { global.location.reload(); }, 50); return;
      }
      if (typeof onReady === 'function') onReady(getUserTier());
    });
  }

  global.DevFitAuth = {
    getUser: getUser, getToken: getToken, setSession: setSession, clearSession: clearSession,
    getUserTier: getUserTier, isPro: isPro, startSession: startSession, reverify: reverify, gate: gate,
    wipeLocalData: wipeLocalData, enforceDataOwner: enforceDataOwner, DATA_KEYS: DATA_KEYS,
    get strict() { return STRICT; }
  };
})(window);
