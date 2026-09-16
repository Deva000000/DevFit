/* DevFit — client auth (Layer 1)
 * Single source of truth for the login gate + tier, shared by every app page.
 *
 * Security model (be honest about it):
 *  - The server issues a SIGNED token (devfit_token). On each page load we send
 *    it to /api/verify, which checks the signature + re-reads the subscriber row
 *    and returns the authoritative tier. A hand-faked localStorage session has
 *    no valid token, so verify returns approved:false and we bounce to login.
 *  - isPro() is only a presentation hint. Every premium action calls
 *    requirePro(), which re-reads the subscriber row through /api/pro-access and
 *    fails closed unless the server confirms a currently-active Pro account.
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
  var PRO_API = '/api/pro-access';
  var STRICT = true; // backend live + verified — forged/absent tokens are now rejected
  var proRequest = null;
  // Capture the real browser fetch before page code or a later console command
  // can replace window.fetch and forge a successful authorization response.
  var requestFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;

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

  // ── Per-account data separation (physical namespacing) ────────────────────
  // Each email's app data is stored under keys suffixed with "::<email>", so two
  // accounts on the SAME device keep completely separate storage and can never
  // mix — no wiping, no timing, no re-download. A tiny shim over localStorage
  // transparently routes these per-user keys to the current email's namespace;
  // every other key (session, theme, device id, onboarding flags) passes through
  // untouched. All app code keeps calling the plain key names — nothing else changes.
  var DATA_KEYS = [
    'progressLog2', 'devfitNutritionV2', 'devfitNutritionV1', 'devfitTrainingV1',
    'devfit_cloud_ts_progress', 'devfit_cloud_ts_nutrition', 'devfit_cloud_ts_workouts',
    'devfit_local_ts_progress', 'devfit_local_ts_nutrition', 'devfit_local_ts_workouts',
    'devfit_cloud_ts_prefs', 'devfit_local_ts_prefs', 'devfit_sync_dirty',
    'devfit_freeWeekKey', 'devfit_displayName',
    'devfit_cardioSessGoal', 'devfit_cardioGoalKm', 'devfit_trendRange', 'devfit_progSection'
  ];
  var DATA_KEY_SET = {};
  DATA_KEYS.forEach(function (k) { DATA_KEY_SET[k] = true; });

  (function installNamespaceShim() {
    var LS;
    try { LS = global.localStorage; } catch (e) { return; }
    if (!LS) return;
    var origGet = LS.getItem.bind(LS);
    var origSet = LS.setItem.bind(LS);
    var origRemove = LS.removeItem.bind(LS);

    function emailNow() {
      try { return (JSON.parse(origGet('devfit_user') || '{}').email || '').trim().toLowerCase(); }
      catch (e) { return ''; }
    }
    // Per-user keys → "key::email"; everything else untouched. Logged-out access
    // (no email) uses a fixed "__anon__" bucket so it never lands on a real account.
    function ns(key) {
      if (!DATA_KEY_SET[key]) return key;
      return key + '::' + (emailNow() || '__anon__');
    }

    // ONE-TIME migration: data written before this shim lived under plain keys.
    // Move it into the owning email's namespace so upgraded users don't see empty
    // data, then clear the plain copies. Uses raw methods (no re-namespacing).
    try {
      if (!origGet('devfit_ns_migrated')) {
        var owner = (origGet('devfit_data_owner') || '').trim().toLowerCase() || emailNow();
        DATA_KEYS.forEach(function (k) {
          var base = origGet(k);
          if (base != null) {
            if (owner && origGet(k + '::' + owner) == null) origSet(k + '::' + owner, base);
            origRemove(k);
          }
        });
        origSet('devfit_ns_migrated', '1');
      }
    } catch (e) {}

    // Legacy recovery/recents keys had no reliable account owner. Keep the raw
    // copies untouched, but never expose them to whichever person signs in next.
    // New recovery copies and recents are scoped exactly like primary records.
    ['devfitTrainingV1__safety', 'devfitTrainingV1__unreadable',
     'devfitNutritionV2__unreadable', 'progressLog2__unreadable',
     'devfit_recent_foods', 'devfit_logResume'].forEach(function (k) {
      DATA_KEYS.push(k); DATA_KEY_SET[k] = true;
    });

    // Friendly one-time warning when the device's localStorage is full, instead
    // of saves silently failing (most call sites swallow the error in try/catch).
    var quotaWarned = false;
    function notifyQuotaFull() {
      if (quotaWarned) return; quotaWarned = true;
      try {
        var b = document.createElement('div');
        b.textContent = '⚠ Your device storage is almost full — recent changes may not save. Free up storage before continuing, then reopen DevFit.';
        b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;background:#7f1d1d;color:#fff;padding:12px 14px;border-radius:10px;font:600 13px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);text-align:center';
        (document.body || document.documentElement).appendChild(b);
        setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 9000);
      } catch (_) {}
    }
    function isQuotaError(e) {
      return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 ||
                   e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    }

    // SCOPE / SAFETY:
    //  - Only get/set/removeItem are namespaced. key(i) / length are intentionally
    //    left as native passthrough: no code in the app enumerates localStorage by
    //    index (verified), so index/length would only ever be used for whole-store
    //    tooling, which should see the real underlying keys. If you ever add code
    //    that iterates localStorage.key(i), namespace-suffixed keys will appear —
    //    filter on the "::" suffix there rather than expecting plain names.
    //  - LOAD ORDER: this file MUST load before any script that reads/writes a
    //    per-user DATA_KEY, or that access lands in the un-namespaced bucket. All
    //    pages load devfit-auth.js ahead of app logic and devfit-db.js — keep it so.
    try {
      LS.getItem = function (k) { return origGet(ns(k)); };
      LS.setItem = function (k, v) {
        try { return origSet(ns(k), v); }
        catch (e) { if (isQuotaError(e)) notifyQuotaFull(); throw e; }
      };
      LS.removeItem = function (k) { return origRemove(ns(k)); };
    } catch (e) { /* override blocked → app still works on plain keys */ }
  })();

  function currentEmail() { return (getUser().email || '').trim().toLowerCase(); }

  // Wipe just the CURRENT account's data (used by reset and account flows). The shim
  // scopes these removes to the current email's namespace, so it never touches
  // any other account.
  function wipeLocalData() {
    try { DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }

  // Retained for compatibility; namespacing now makes cross-account mixing
  // structurally impossible, so this only records the active owner (no wiping).
  function enforceDataOwner() {
    try {
      var current = currentEmail();
      if (current) localStorage.setItem('devfit_data_owner', current);
    } catch (e) {}
  }
  enforceDataOwner();

  // Tier as the client sees it — trusts the last verified value, but still
  // auto-reverts to Free the moment the paid period ends (offline-safe).
  function getUserTier() {
    try {
      var u = getUser();
      var t = (u.tier || 'free').toLowerCase();
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
    } catch (e) { return 'free'; }
  }
  function isPro() { return getUserTier() === 'pro'; }

  // Authoritative action-time Pro check. UI styling may use the cached tier for
  // fast first paint, but premium calculations/exports/history must await this
  // function. A backend outage pauses only the premium action; it never logs the
  // user out or touches saved data.
  async function requirePro() {
    var u = getUser();
    var token = getToken();
    if (!u.email || !token) {
      clearSession();
      global.location.href = 'login.html';
      return false;
    }

    try {
      // Coalesce double taps without caching authorization beyond the request.
      if (!proRequest) {
        proRequest = (async function () {
          if (!requestFetch) throw new Error('fetch_unavailable');
          var response = await requestFetch(PRO_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            cache: 'no-store',
            body: JSON.stringify({ deviceId: deviceId() })
          });
          var payload = {};
          try { payload = await response.json(); } catch (_) {}
          return { response: response, payload: payload };
        })();
      }
      var checked = await proRequest;
      var res = checked.response;
      var data = checked.payload;

      if (res.ok && data && data.authorized === true && data.tier === 'pro') {
        u.tier = 'pro';
        if (data.expiry !== undefined) u.expiry = data.expiry;
        if (data.startDate !== undefined) u.startDate = data.startDate;
        if (data.plan !== undefined) u.plan = data.plan;
        if (data.name) u.name = data.name;
        setSession(u, data.token || token);
        return true;
      }

      if (res.status === 401 || data.error === 'invalid_token' || data.error === 'revoked') {
        clearSession();
        global.location.href = 'login.html';
        return false;
      }
      if (res.status === 403 || data.error === 'pro_required') {
        u.tier = 'free';
        if (data.expiry !== undefined) u.expiry = data.expiry;
        setSession(u, data.token || token);
        global.location.href = 'pricing.html';
        return false;
      }

      try { global.alert('DevFit could not verify Pro access right now. Your saved data is safe. Check your connection and try again.'); } catch (_) {}
      return false;
    } catch (e) {
      try { global.alert('DevFit could not verify Pro access right now. Your saved data is safe. Check your connection and try again.'); } catch (_) {}
      return false;
    } finally {
      proRequest = null;
    }
  }

  // Exchange a verified identity token (Supabase/Google) for a signed session.
  // Returns { approved, ... } or throws on transport error.
  async function startSession(provider, providerToken, name) {
    if (!requestFetch) throw new Error('fetch_unavailable');
    var res = await requestFetch(SESSION_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ provider: provider, token: providerToken, deviceId: deviceId() })
    });
    if (res.status === 501) return { notConfigured: true };
    var data = await res.json();
    if (data && data.approved) {
      setSession({
        email: data.email, name: data.name || name || '', approved: true,
        plan: data.plan || '', expiry: data.expiry || '', startDate: data.startDate || '',
        tier: (data.tier || 'free').toLowerCase()
      }, data.token);
    }
    return data;
  }

  // Re-verify the persistent session against the server. Updates the cached tier.
  // Returns 'ok' | 'reload' | 'kick' | 'skip' (skip = offline/not-configured).
  async function reverify() {
    var u = getUser();
    if (!u.email) return 'kick';
    try {
      if (!requestFetch) return 'skip';
      var res = await requestFetch(VERIFY_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ token: getToken(), email: u.email, deviceId: deviceId() })
      });
      if (res.status === 501) return 'skip'; // not configured yet → trust cache
      // A temporary backend outage must never look like account revocation and
      // log out a valid installed PWA. Keep the cached session and retry later.
      if (res.status === 429 || res.status >= 500) return 'skip';
      var data = await res.json();
      if (data && data.approved) {
        var oldTier = (u.tier || '').toLowerCase();
        var newTier = (data.tier || 'free').toLowerCase();
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

  var authApi = {
    getUser: getUser, getToken: getToken, setSession: setSession, clearSession: clearSession,
    getUserTier: getUserTier, isPro: isPro, requirePro: requirePro,
    startSession: startSession, reverify: reverify, gate: gate,
    wipeLocalData: wipeLocalData, enforceDataOwner: enforceDataOwner, DATA_KEYS: DATA_KEYS,
    get strict() { return STRICT; }
  };
  // Stop ordinary console overrides such as `DevFitAuth.requirePro=()=>true` or
  // replacing the whole object. This is defence in depth; the server remains the
  // authority and still rejects every Free, expired, revoked or unsigned call.
  try {
    Object.freeze(authApi);
    Object.defineProperty(global, 'DevFitAuth', {
      value: authApi, writable: false, configurable: false, enumerable: true
    });
  } catch (e) { global.DevFitAuth = authApi; }
})(window);
