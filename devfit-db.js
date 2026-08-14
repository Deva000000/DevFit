/**
 * DevFit Cloud Sync — via the token-authenticated /api/data proxy.
 * Keeps progress, nutrition and workout data synced across all devices.
 * localStorage stays as the offline cache — sync is additive, never destructive.
 *
 * SECURITY: the browser no longer talks to Supabase directly. All reads/writes go
 * through /api/data, which derives the email from the SIGNED session token, so a
 * user can only ever touch their own row. The Supabase table denies the public
 * anon key entirely; only the server (service-role key) can reach it.
 *
 * SYNC MODEL — pull, merge, then push. Never blind-overwrite.
 *
 * The old model was last-writer-wins on the whole document, gated on a timestamp.
 * Two things made that lose real training data:
 *
 *   1. A page could save() during its first render — before the sync had pulled.
 *      That stamped the local clock to "now", so the pull was skipped as
 *      unnecessary and the device pushed its STALE copy over the good cloud one.
 *      A session logged on a phone died the next time a tablet was opened. On iOS
 *      the installed PWA and Safari have separate localStorage, so one person with
 *      one device hit this too.
 *   2. Even when the timestamps were right, whichever side won replaced the whole
 *      document. A day logged on the losing side was simply gone.
 *
 * So now: the FIRST cloud write of a page is always preceded by a pull, and the
 * two copies are merged rather than swapped. Sessions, logged sets and food days
 * are unioned — a record that exists on either side survives. Deletions still
 * propagate, but only through explicit tombstones, so "it vanished" can never be
 * the accidental outcome of two devices disagreeing.
 */
(function (global) {
  'use strict';

  // Account persistence is enabled. The server rejects stale whole-document
  // writes, the client merges before retrying, and accepted states are archived
  // in append-only history. localStorage remains the fast offline copy.
  const CLOUD_SYNC_ENABLED = true;

  const DATA_API = '/api/data';

  // dataType → the localStorage key holding that document.
  const LOCAL_KEY = {
    progress: 'progressLog2',
    nutrition: 'devfitNutritionV2',
    workouts: 'devfitTrainingV1'
  };

  // Missing/expired sessions stay local; a later authenticated load reconciles.
  function getToken() {
    if (!CLOUD_SYNC_ENABLED) return '';
    try { return localStorage.getItem('devfit_token') || ''; } catch (e) { return ''; }
  }
  function getEmail() {
    try { return JSON.parse(localStorage.getItem('devfit_user') || '{}').email || null; }
    catch (e) { return null; }
  }
  function readLocal(dataType) {
    const k = LOCAL_KEY[dataType];
    if (!k) return null;
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeLocal(dataType, obj) {
    const k = LOCAL_KEY[dataType];
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(obj)); } catch (e) {}
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
    if (res.status === 409) {
      const conflict = await res.json().catch(function () { return {}; });
      conflict.conflict = true;
      return conflict;
    }
    if (!res.ok) throw new Error('data api ' + res.status);
    return await res.json();
  }

  // ══ MERGE ═══════════════════════════════════════════════════════════════
  // Two copies of the same document, neither authoritative. `winner` decides
  // scalar conflicts (a value present and different on both sides); everything
  // that accumulates — sessions, sets, food days — is unioned so that a record
  // logged on either device survives the reconcile.

  function normKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function isBlank(v) { return v === '' || v === null || typeof v === 'undefined'; }
  function num(v) { return Number(v) || 0; }

  // Shallow "winner wins, loser fills the gaps it left blank".
  function fillGaps(winner, loser) {
    const out = Object.assign({}, loser, winner);
    Object.keys(loser || {}).forEach(function (k) {
      if (isBlank(out[k]) && !isBlank(loser[k])) out[k] = loser[k];
    });
    return out;
  }

  // ── workouts ────────────────────────────────────────────────────────────
  // A session is identified by the day it happened plus which workout it was —
  // its random `id` is not stable across devices that logged independently.
  function sessionKey(s) {
    return String((s && s.date) || '') + '|' + String((s && s.workoutId) || '');
  }
  // A log row is identified by exercise NAME where we have one (ids churn every
  // time a plan is rebuilt), falling back to the id for rows written before
  // names were stamped.
  function logKey(l) {
    return normKey(l && l.name) || ('#' + String((l && l.exId) || ''));
  }
  function setHasData(s) {
    if (!s) return false;
    return Object.keys(s).some(function (k) { return num(s[k]) > 0; });
  }
  function logFilledCount(l) {
    if (!l || !Array.isArray(l.sets)) return 0;
    return l.sets.filter(setHasData).length;
  }

  // Merge one exercise's two versions: union the sets by position, and inside a
  // set take the winner's number but never let a blank erase a real one.
  function mergeLog(win, los) {
    const out = fillGaps(win, los);
    out.name = win.name || los.name || '';
    const a = Array.isArray(win.sets) ? win.sets : [];
    const b = Array.isArray(los.sets) ? los.sets : [];
    const n = Math.max(a.length, b.length);
    const sets = [];
    for (let i = 0; i < n; i++) {
      const sa = a[i], sb = b[i];
      if (!sa) { sets.push(sb); continue; }
      if (!sb) { sets.push(sa); continue; }
      const m = {};
      const keys = {};
      Object.keys(sa).forEach(function (k) { keys[k] = 1; });
      Object.keys(sb).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        m[k] = isBlank(sa[k]) ? sb[k] : sa[k];
      });
      sets.push(m);
    }
    out.sets = sets;
    return out;
  }

  function mergeSession(win, los) {
    const out = fillGaps(win, los);
    const by = new Map();
    const add = function (log, isWinner) {
      if (!log) return;
      const k = logKey(log);
      const prev = by.get(k);
      if (!prev) { by.set(k, { log: log, win: isWinner }); return; }
      // Both sides have this exercise — merge them, winner leading.
      const w = prev.win ? prev.log : log;
      const l = prev.win ? log : prev.log;
      by.set(k, { log: mergeLog(w, l), win: true });
    };
    (win.logs || []).forEach(function (l) { add(l, true); });
    (los.logs || []).forEach(function (l) { add(l, false); });
    out.logs = Array.from(by.values()).map(function (v) { return v.log; });
    out.mts = Math.max(num(win.mts), num(los.mts));
    return out;
  }

  // Tombstones: `{k:'<date>|<workoutId>', ts}`. A delete only wins over a session
  // that has not been touched since the delete happened, so re-logging that day
  // afterwards is safe.
  function mergeTombstones(a, b) {
    const by = new Map();
    (a || []).concat(b || []).forEach(function (t) {
      if (!t || !t.k) return;
      const prev = by.get(t.k);
      if (!prev || num(t.ts) > num(prev.ts)) by.set(t.k, { k: t.k, ts: num(t.ts) });
    });
    const cutoff = Date.now() - 180 * 86400000;   // half a year is plenty
    return Array.from(by.values())
      .filter(function (t) { return t.ts > cutoff; })
      .sort(function (x, y) { return y.ts - x.ts; })
      .slice(0, 400);
  }

  function mergeSessionArrays(winArr, losArr, tombs) {
    const by = new Map();
    const add = function (s, isWinner) {
      if (!s || !s.date) return;
      const k = sessionKey(s);
      const prev = by.get(k);
      if (!prev) { by.set(k, { s: s, win: isWinner }); return; }
      const w = prev.win ? prev.s : s;
      const l = prev.win ? s : prev.s;
      by.set(k, { s: mergeSession(w, l), win: true });
    };
    (winArr || []).forEach(function (s) { add(s, true); });
    (losArr || []).forEach(function (s) { add(s, false); });

    const dead = new Map();
    (tombs || []).forEach(function (t) { dead.set(t.k, num(t.ts)); });

    return Array.from(by.entries())
      .filter(function (e) {
        const ts = dead.get(e[0]);
        if (!ts) return true;
        return num(e[1].s.mts) > ts;     // re-logged after the delete → keep
      })
      .map(function (e) { return e[1].s; })
      .sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });
  }

  function mergeArchives(a, b) {
    const by = new Map();
    (a || []).concat(b || []).forEach(function (x) {
      if (!x) return;
      const k = x.id || (String(x.from) + '|' + String(x.to) + '|' + String(x.count));
      if (!by.has(k)) by.set(k, x);
    });
    return Array.from(by.values())
      .sort(function (x, y) { return num(y.savedAt) - num(x.savedAt); })
      .slice(0, 8);
  }

  function mergeWorkouts(win, los) {
    const out = fillGaps(win, los);
    out._deleted = mergeTombstones(win._deleted, los._deleted);
    out.sessions = mergeSessionArrays(win.sessions, los.sessions, out._deleted);
    out.cycleArchive = mergeArchives(win.cycleArchive, los.cycleArchive);
    // The plan itself is edited, not accumulated — the winner's is the current one.
    out.plan = win.plan && (win.plan.workouts || win.plan.name) ? win.plan : (los.plan || win.plan);
    if (!Array.isArray(out.planLibrary)) out.planLibrary = los.planLibrary || [];
    return out;
  }

  // ── nutrition ───────────────────────────────────────────────────────────
  // `days` is a calendar-keyed map, so a plain key union is exactly right. For a
  // day both sides logged, keep the fuller one — a device that recorded four
  // meals should never be beaten by one that recorded none.
  function dayWeight(d) {
    if (!d) return 0;
    if (Array.isArray(d.foods)) return d.foods.length;
    if (Array.isArray(d.meals)) return d.meals.reduce(function (n, m) {
      return n + ((m && m.items && m.items.length) || 0);
    }, 0);
    return Object.keys(d).length;
  }
  function mergeNutrition(win, los) {
    const out = fillGaps(win, los);
    const days = Object.assign({}, los.days || {});
    Object.keys(win.days || {}).forEach(function (k) {
      const w = win.days[k], l = days[k];
      days[k] = (!l || dayWeight(w) >= dayWeight(l)) ? w : l;
    });
    out.days = days;
    return out;
  }

  // ── progress ────────────────────────────────────────────────────────────
  function weekDate(start, index) {
    const d = new Date(String(start || '') + 'T00:00:00Z');
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + index * 7);
    return d.toISOString().slice(0, 10);
  }

  function mergeCells(incoming, existing) {
    const a = Array.isArray(incoming) ? incoming : [];
    const b = Array.isArray(existing) ? existing : [];
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length, 7); i++) {
      out[i] = isBlank(a[i]) ? (typeof b[i] === 'undefined' ? '' : b[i]) : a[i];
    }
    return out;
  }

  // Normalize each visible/archive week to its Monday before merging. This lets
  // two devices edit different weeks or different days without confusing index 0
  // from programs with different start dates.
  function mergeProgress(win, los) {
    // v2 programs carry immutable ids. Two programs may cover the same Monday,
    // so calendar date alone is no longer an identity and must never re-anchor a
    // new Week 1 onto an older program. The model also migrates both legacy docs
    // before merging, preserving every old week as a recoverable program.
    if (global.DevFitProgress && typeof global.DevFitProgress.mergeDocuments === 'function') {
      return global.DevFitProgress.mergeDocuments(win, los);
    }
    // Fail closed if the model script was unavailable: preserving the preferred
    // complete document is safer than combining distinct programs by date. A
    // later healthy load will perform the full program-aware merge.
    if ((win && win.progressSchema === 2) || (los && los.progressSchema === 2) ||
        (win && los && win.programStart && los.programStart && win.programStart !== los.programStart)) {
      return fillGaps(win, los);
    }
    const out = fillGaps(win, los);
    const weeks = new Map();
    const collectTimeline = function (source) {
      if (!source || !source.programStart) return;
      const count = Math.max(
        (source.bw || []).length,
        (source.steps || []).length,
        (source.sleep || []).length,
        (source.weeklyCheckin || []).length
      );
      for (let i = 0; i < count; i++) {
        const date = weekDate(source.programStart, i);
        if (!date) continue;
        const old = weeks.get(date) || {};
        weeks.set(date, {
          bw: mergeCells(source.bw && source.bw[i], old.bw),
          steps: mergeCells(source.steps && source.steps[i], old.steps),
          sleep: mergeCells(source.sleep && source.sleep[i], old.sleep),
          checkin: fillGaps(source.weeklyCheckin && source.weeklyCheckin[i] || {}, old.checkin || {})
        });
      }
    };
    const collectDoc = function (doc) {
      if (!doc) return;
      collectTimeline(doc._proHistory);
      collectTimeline(doc);
    };
    collectDoc(los);
    collectDoc(win);

    const dates = Array.from(weeks.keys()).sort();
    if (!dates.length) return out;
    const first = new Date(dates[0] + 'T00:00:00Z');
    const last = new Date(dates[dates.length - 1] + 'T00:00:00Z');
    const span = Math.round((last - first) / (7 * 86400000)) + 1;
    if (span < 1 || span > 520) return out;

    out.programStart = dates[0];
    out.bw = []; out.steps = []; out.sleep = []; out.weeklyCheckin = [];
    for (let i = 0; i < span; i++) {
      const wk = weeks.get(weekDate(dates[0], i)) || {};
      out.bw.push(wk.bw || Array(7).fill(''));
      out.steps.push(wk.steps || Array(7).fill(''));
      out.sleep.push(wk.sleep || Array(7).fill(''));
      out.weeklyCheckin.push(wk.checkin || {});
    }
    delete out._proHistory;
    delete out.freeWeekOf;
    return out;
  }

  function mergeDoc(dataType, winner, loser) {
    const w = winner || {}, l = loser || {};
    if (!winner) return l;
    if (!loser) return w;
    try {
      if (dataType === 'workouts') return mergeWorkouts(w, l);
      if (dataType === 'nutrition') return mergeNutrition(w, l);
      if (dataType === 'progress') return mergeProgress(w, l);
    } catch (e) {
      console.warn('[DevFit Cloud] merge failed (' + dataType + '), keeping winner:', e);
    }
    return w;
  }

  // Account backup is deliberately invisible in the product UI.
  function setIndicator() {}

  // ── Reconcile state ───────────────────────────────────────────────────────
  // pulled[type]   — the initial pull+merge for this type has completed.
  // pulling[type]  — a pull is in flight; its promise, so callers can await it.
  // notify[type]   — the page's callback for "here is the reconciled document".
  const pulled = {};
  const pulling = {};
  const notify = {};
  const cloudVersion = {};
  const pendingSave = {};
  const saveWorker = {};

  // Effective local timestamp = most recent of last cloud sync and last local edit.
  function localTsFor(dataType) {
    const synced = parseInt(localStorage.getItem('devfit_cloud_ts_' + dataType) || '0', 10);
    const edited = parseInt(localStorage.getItem('devfit_local_ts_' + dataType) || '0', 10);
    return Math.max(synced || 0, edited || 0);
  }

  // Raw upload. Everything that decides WHETHER to upload lives in cloudSave.
  async function push(dataType, data) {
    setIndicator('syncing');
    try {
      let candidate = data;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await apiCall('set', {
          dataType: dataType,
          data: candidate,
          baseUpdatedAt: cloudVersion[dataType] || '',
          deviceId: localStorage.getItem('devfit_device_id') || 'unknown'
        });
        if (r && r.skip) { setIndicator('offline'); return false; }
        if (r && r.conflict && r.row) {
          const serverTs = new Date(r.row.updated_at).getTime();
          const serverWins = serverTs > localTsFor(dataType) + 3000;
          candidate = serverWins
            ? mergeDoc(dataType, r.row.data, candidate)
            : mergeDoc(dataType, candidate, r.row.data);
          cloudVersion[dataType] = r.row.updated_at || '';
          if (LOCAL_KEY[dataType]) writeLocal(dataType, candidate);
          if (typeof notify[dataType] === 'function') {
            try { notify[dataType](candidate); } catch (e) {}
          }
          continue;
        }
        cloudVersion[dataType] = (r && r.updated_at) || cloudVersion[dataType] || '';
        localStorage.setItem('devfit_cloud_ts_' + dataType, String(Date.now()));
        setIndicator('ok');
        return true;
      }
      throw new Error('save conflict did not converge');
    } catch (e) {
      console.warn('[DevFit Cloud] save failed (' + dataType + '):', e.message || e);
      setIndicator('err');
      return false;
    }
  }

  /**
   * Pull the cloud copy, merge it with whatever is in localStorage right now,
   * write the result back locally, hand it to the page, and push it up.
   * Runs at most once concurrently per data type.
   */
  function reconcile(dataType) {
    if (pulling[dataType]) return pulling[dataType];
    const p = (async function () {
      const localTs = localTsFor(dataType);
      let merged = readLocal(dataType);
      try {
        const r = await apiCall('get');
        if (r && r.skip) { setIndicator('offline'); return merged; }
        const rows = (r && r.rows) || [];
        const row = rows.filter(function (x) { return x.data_type === dataType; })[0];

        if (row && row.data) {
          cloudVersion[dataType] = row.updated_at || '';
          const cloudTs = new Date(row.updated_at).getTime();
          // The timestamp no longer decides who SURVIVES — only who wins a
          // straight conflict on the same field. Everything additive is unioned
          // either way, which is what stops a stale device erasing a good day.
          const cloudWins = cloudTs > localTs + 3000;
          merged = cloudWins
            ? mergeDoc(dataType, row.data, merged)
            : mergeDoc(dataType, merged, row.data);
          writeLocal(dataType, merged);
          localStorage.setItem('devfit_cloud_ts_' + dataType, String(cloudTs));
          if (typeof notify[dataType] === 'function') {
            try { notify[dataType](merged); } catch (e) {}
          }
        } else cloudVersion[dataType] = '';
        setIndicator('ok');
      } catch (e) {
        console.warn('[DevFit Cloud] sync failed (' + dataType + '):', e.message || e);
        setIndicator('err');
      }
      return merged;
    })();

    pulling[dataType] = p;
    p.then(function () { pulled[dataType] = true; pulling[dataType] = null; },
           function () { pulled[dataType] = true; pulling[dataType] = null; });
    return p;
  }

  // ── Core save ─────────────────────────────────────────────────────────────
  /**
   * Save data to the cloud. Fire-and-forget — never blocks UI.
   *
   * The first save on a page waits for the pull, then uploads the MERGED
   * document rather than the caller's copy. That one rule is what stops a device
   * that has been closed for a week from deleting everything logged since.
   *
   * @param {'progress'|'nutrition'|'workouts'} dataType
   * @param {object} data
   */
  async function cloudSave(dataType, data) {
    // Record the local-modified time synchronously, BEFORE any async work — the
    // source of truth for "local has unsynced edits newer than the cloud copy",
    // so an edit is never clobbered even if the user navigates away mid-upload.
    try { localStorage.setItem('devfit_local_ts_' + dataType, String(Date.now())); } catch (_) {}
    if (!getToken()) return;
    pendingSave[dataType] = data;
    if (!saveWorker[dataType]) {
      saveWorker[dataType] = (async function () {
        if (!pulled[dataType] && LOCAL_KEY[dataType]) await reconcile(dataType);
        while (pendingSave[dataType]) {
          let latest = pendingSave[dataType];
          pendingSave[dataType] = null;
          if (LOCAL_KEY[dataType]) latest = readLocal(dataType) || latest;
          await push(dataType, latest);
        }
      })();
    }
    try { await saveWorker[dataType]; }
    finally { saveWorker[dataType] = null; }
  }

  // ── Startup sync (single data type) ───────────────────────────────────────
  /**
   * On page load: reconcile local and cloud for one data type. onNewData is
   * called with the merged document whenever the cloud had something to add.
   */
  async function cloudSync(dataType, localKey, onNewData) {
    if (localKey && !LOCAL_KEY[dataType]) LOCAL_KEY[dataType] = localKey;
    if (typeof onNewData === 'function') notify[dataType] = onNewData;
    if (!getToken()) return;
    setIndicator('syncing');
    const merged = await reconcile(dataType);
    // Local had edits the cloud has not seen (offline logging, or a first run) —
    // send the reconciled copy up so the other devices converge on it.
    if (merged) await push(dataType, merged);
  }

  // ── Restore-on-load sync (all types, timestamp-safe) ─────────────────────
  /**
   * Reconcile every data type with the cloud. Non-destructive by construction:
   * both copies are merged, so this can only ever ADD records back.
   * Returns { ok, updated, reason? }.
   */
  async function forceSyncAll() {
    if (!CLOUD_SYNC_ENABLED) return { ok: false, reason: 'Cloud sync is off — your data is saved on this device', off: true };
    if (!getToken()) return { ok: false, reason: 'Not signed in' };
    setIndicator('syncing');
    try {
      const types = Object.keys(LOCAL_KEY);
      let updated = 0;
      for (const t of types) {
        const before = JSON.stringify(readLocal(t) || null);
        pulled[t] = false;                       // force a fresh look
        const merged = await reconcile(t);
        if (merged) {
          if (JSON.stringify(merged) !== before) updated++;
          await push(t, merged);
        }
      }
      setIndicator('ok');
      return { ok: true, updated: updated };
    } catch (e) {
      setIndicator('err');
      return { ok: false, reason: e.message || String(e) };
    }
  }

  // ── Push all local data to cloud (first-time setup / backup) ─────────────
  async function pushAllLocal() {
    for (const t of Object.keys(LOCAL_KEY)) {
      const local = readLocal(t);
      if (local) { try { await cloudSave(t, local); } catch (_) {} }
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
    try { await cloudSave('prefs', obj); } catch (e) {}
  }

  async function restorePrefs() {
    if (!getToken()) return;
    try {
      const r = await apiCall('get');
      if (!r || r.skip) return;
      const row = ((r && r.rows) || []).filter(function (x) { return x.data_type === 'prefs'; })[0];
      if (!row || !row.data) return;
      cloudVersion.prefs = row.updated_at || '';
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
    restorePrefs: restorePrefs,
    enabled: CLOUD_SYNC_ENABLED,
    // Exposed so the training page can reuse the exact identity rules the merge
    // uses when it repairs id-orphaned rows locally.
    _merge: mergeDoc
  };

})(window);
