/**
 * DevFit Cloud Sync — via the token-authenticated /api/data proxy.
 * Keeps progress, nutrition and workout data synced across all devices.
 * localStorage stays as the offline cache — sync is additive, never destructive.
 *
 * SECURITY: the browser no longer talks to Supabase directly. All reads/writes go
 * through /api/data, which derives the email from the SIGNED session token, so a
 * user can only ever touch their own row. The Supabase table denies the public
 * anon key entirely; only the server (service-role key) can reach it.
 */
(function (global) {
  'use strict';

  const DATA_API = '/api/data';

  function getToken() {
    try { return localStorage.getItem('devfit_token') || ''; } catch (e) { return ''; }
  }
  function getEmail() {
    try { return JSON.parse(localStorage.getItem('devfit_user') || '{}').email || null; }
    catch (e) { return null; }
  }

  // Core transport. Resolves to the parsed JSON, or { skip:true } when there is no
  // session/token or the backend isn't configured — callers treat skip as "stay
  // local, try again later" and never surface an error or lose data.
  async function apiCall(op, extra) {
    const token = getToken();
    if (!token) return { skip: true, reason: 'no_token' };
    const res = await fetch(DATA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(Object.assign({ token: token, op: op }, extra || {}))
    });
    if (res.status === 501 || res.status === 401) return { skip: true, status: res.status };
    if (!res.ok) throw new Error('data api ' + res.status);
    return await res.json();
  }

  // ── Sync indicator dot (injected into header automatically) ──────────────
  function injectDot() {
    if (document.getElementById('devfit-cloud-dot')) return;
    const header = document.querySelector('.header') || document.querySelector('header');
    if (!header) return;
    const dot = document.createElement('span');
    dot.id = 'devfit-cloud-dot';
    dot.title = 'Cloud sync';
    dot.style.cssText = [
      'display:inline-block', 'width:7px', 'height:7px', 'border-radius:50%',
      'background:#6b7280', 'position:absolute', 'top:10px', 'right:14px',
      'transition:background .4s', 'z-index:999', 'cursor:default'
    ].join(';');
    header.style.position = 'relative';
    header.appendChild(dot);
  }

  function setIndicator(state) {
    const el = document.getElementById('devfit-cloud-dot');
    if (!el) return;
    const colours = { syncing: '#f59e0b', ok: '#22c55e', err: '#6b7280', offline: '#6b7280' };
    el.style.background = colours[state] || colours.offline;
    const labels = { syncing: 'Syncing…', ok: 'Synced ✓', err: 'Sync error', offline: 'Offline' };
    el.title = labels[state] || 'Cloud sync';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDot);
  } else {
    injectDot();
  }

  // ── Core save ─────────────────────────────────────────────────────────────
  /**
   * Save data to the cloud. Fire-and-forget — never blocks UI.
   * @param {'progress'|'nutrition'|'workouts'} dataType
   * @param {object} data
   */
  async function cloudSave(dataType, data) {
    // Record the local-modified time synchronously, BEFORE any async work — the
    // source of truth for "local has unsynced edits newer than the cloud copy",
    // so an edit is never clobbered even if the user navigates away mid-upload.
    try { localStorage.setItem('devfit_local_ts_' + dataType, String(Date.now())); } catch (_) {}
    if (!getToken()) return;
    setIndicator('syncing');
    try {
      const r = await apiCall('set', { dataType: dataType, data: data });
      if (r && r.skip) { setIndicator('offline'); return; }
      localStorage.setItem('devfit_cloud_ts_' + dataType, String(Date.now()));
      setIndicator('ok');
    } catch (e) {
      console.warn('[DevFit Cloud] save failed (' + dataType + '):', e.message || e);
      setIndicator('err');
    }
  }

  // Effective local timestamp = most recent of last cloud sync and last local edit.
  function localTsFor(dataType) {
    const synced = parseInt(localStorage.getItem('devfit_cloud_ts_' + dataType) || '0', 10);
    const edited = parseInt(localStorage.getItem('devfit_local_ts_' + dataType) || '0', 10);
    return Math.max(synced || 0, edited || 0);
  }

  // ── Startup sync (single data type) ───────────────────────────────────────
  /**
   * On page load: compare local vs cloud timestamps for one data type.
   * Cloud newer → pull + call onNewData(parsedData). Local newer → push up.
   */
  async function cloudSync(dataType, localKey, onNewData) {
    if (!getToken()) return;
    setIndicator('syncing');
    const localTs = localTsFor(dataType);
    try {
      const r = await apiCall('get');
      if (r && r.skip) { setIndicator('offline'); return; }
      const rows = (r && r.rows) || [];
      const row = rows.filter(function (x) { return x.data_type === dataType; })[0];

      if (!row) {
        // Nothing in cloud yet — push local up.
        const raw = localStorage.getItem(localKey);
        if (raw) { try { await cloudSave(dataType, JSON.parse(raw)); } catch (_) {} }
        setIndicator('ok');
        return;
      }

      const cloudTs = new Date(row.updated_at).getTime();
      if (cloudTs > localTs + 3000) {
        // Cloud meaningfully newer — adopt it and notify the page.
        localStorage.setItem(localKey, JSON.stringify(row.data));
        localStorage.setItem('devfit_cloud_ts_' + dataType, String(cloudTs));
        setIndicator('ok');
        if (typeof onNewData === 'function') onNewData(row.data);
      } else {
        // Local same or newer — push up.
        const raw = localStorage.getItem(localKey);
        if (raw) { try { await cloudSave(dataType, JSON.parse(raw)); } catch (_) {} }
        setIndicator('ok');
      }
    } catch (e) {
      console.warn('[DevFit Cloud] sync failed (' + dataType + '):', e.message || e);
      setIndicator('err');
    }
  }

  // ── Restore-on-load sync (all types, timestamp-safe) ─────────────────────
  /**
   * Reconcile every data type with the cloud, respecting timestamps so it is
   * non-destructive: a cloud copy only overwrites local when genuinely newer;
   * otherwise local is pushed up. Returns { ok, updated, reason? }.
   */
  async function forceSyncAll() {
    if (!getToken()) return { ok: false, reason: 'Not signed in' };
    setIndicator('syncing');
    try {
      const r = await apiCall('get');
      if (r && r.skip) { setIndicator('offline'); return { ok: false, reason: 'Not connected — check your internet' }; }
      const rows = (r && r.rows) || [];
      const keyMap = {
        progress: 'progressLog2',
        nutrition: 'devfitNutritionV2',
        workouts: 'devfitTrainingV1'
      };
      let updated = 0;
      rows.forEach(function (row) {
        const lk = keyMap[row.data_type];
        if (!lk || !row.data) return;
        const cloudTs = new Date(row.updated_at).getTime();
        const localTs = localTsFor(row.data_type);
        if (cloudTs > localTs + 3000) {
          localStorage.setItem(lk, JSON.stringify(row.data));
          localStorage.setItem('devfit_cloud_ts_' + row.data_type, String(cloudTs));
          updated++;
        } else if (localTs > cloudTs) {
          const raw = localStorage.getItem(lk);
          if (raw) { try { cloudSave(row.data_type, JSON.parse(raw)); } catch (_) {} }
        }
      });
      setIndicator('ok');
      return { ok: true, updated: updated };
    } catch (e) {
      setIndicator('err');
      return { ok: false, reason: e.message || String(e) };
    }
  }

  // ── Push all local data to cloud (first-time setup / backup) ─────────────
  async function pushAllLocal() {
    const types = [
      { type: 'progress', key: 'progressLog2' },
      { type: 'nutrition', key: 'devfitNutritionV2' },
      { type: 'workouts', key: 'devfitTrainingV1' }
    ];
    for (const t of types) {
      const raw = localStorage.getItem(t.key);
      if (raw) { try { await cloudSave(t.type, JSON.parse(raw)); } catch (_) {} }
    }
  }

  // ── Preferences backup (iOS ITP / device-change durability) ───────────────
  // The big three data types already re-download from the cloud after Safari's
  // 7-day storage eviction. These small per-user keys (display name, goals, view
  // prefs) were device-only, so an eviction or a new device silently reset them.
  // We mirror them to the cloud under a 'prefs' row and restore any that are
  // missing locally — non-destructive, so a fresher local value always wins.
  const PREF_KEYS = [
    'devfit_displayName', 'devfit_cardioGoalKm', 'devfit_cardioSessGoal',
    'devfit_trendRange', 'devfit_progSection', 'devfit_theme', 'devfit_shareFont'
  ];

  async function backupPrefs() {
    if (!getToken()) return;
    const obj = {}; let any = false;
    PREF_KEYS.forEach(function (k) {
      let v = null; try { v = localStorage.getItem(k); } catch (e) {}
      if (v != null) { obj[k] = v; any = true; }
    });
    if (!any) return;
    try { await apiCall('set', { dataType: 'prefs', data: obj }); } catch (e) {}
  }

  async function restorePrefs() {
    if (!getToken()) return;
    try {
      const r = await apiCall('get');
      if (!r || r.skip) return;
      const row = ((r && r.rows) || []).filter(function (x) { return x.data_type === 'prefs'; })[0];
      if (!row || !row.data) return;
      Object.keys(row.data).forEach(function (k) {
        if (PREF_KEYS.indexOf(k) < 0) return;
        try { if (localStorage.getItem(k) == null) localStorage.setItem(k, row.data[k]); } catch (e) {}
      });
    } catch (e) {}
  }

  // On load: restore any missing prefs, then push the current set up. Also back up
  // whenever the app is hidden (tab switch / app backgrounded) so the latest values
  // are captured without touching every pref call site.
  function initPrefsSync() {
    if (!getToken()) return;
    restorePrefs().then(backupPrefs);
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) backupPrefs();
      });
    } catch (e) {}
  }
  // Delay so the primary data sync goes first.
  setTimeout(initPrefsSync, 2500);

  // ── Public API (unchanged surface) ────────────────────────────────────────
  global.DevFitDB = {
    cloudSave: cloudSave,
    cloudSync: cloudSync,
    forceSyncAll: forceSyncAll,
    pushAllLocal: pushAllLocal,
    setIndicator: setIndicator,
    backupPrefs: backupPrefs,
    restorePrefs: restorePrefs
  };

})(window);
