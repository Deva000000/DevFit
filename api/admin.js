// DevFit — POST /api/admin
// The trainer's backend for admin.html. Password-gated (DEVFIT_ADMIN_PASSWORD)
// and rate-limited so the password can't be brute-forced. Replaces editing the
// Google Sheet by hand.
//
// Body: { password, action, ...args }
//   action 'list'                                  → { subscribers:[...] }
//   action 'get'      { email }                    → { subscriber }
//   action 'activate' { email, days=30, name, plan } → sets pro, expiry today+days
//   action 'extend'   { email, days=30 }           → adds days to current expiry
//   action 'deactivate' { email }                  → tier 'free' (data kept)
//   action 'revoke'   { email }                    → approved:false (kicked out)
//   action 'backupPage' { table, offset }          → bounded owner-backup page
//   action 'deletePreview' { email }                → exact deletion counts
//   action 'deleteAccount' { email, confirmEmail, confirmation } → permanent

import crypto from 'crypto';
import {
  haveServerConfig, sbSelect, sbUpsert, sbRpc, getSubscriber,
  rateLimit, clientIp, readJsonBody, listLogins
} from './_lib.js';

const ADMIN_PW = process.env.DEVFIT_ADMIN_PASSWORD || '';
const BACKUP_TABLES = {
  devfit_subscribers: 'email.asc',
  devfit_data: 'email.asc,data_type.asc',
  devfit_data_versions: 'id.asc',
  devfit_logins: 'email.asc,device_id.asc',
  devfit_config: 'id.asc'
};
const BACKUP_PAGE_ROWS = 50;
const BACKUP_PAGE_BYTES = 2500000;

// Constant-time password check so response timing can't leak how many leading
// characters matched. Length-mismatch still returns false without comparing.
function pwOk(given) {
  try {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(ADMIN_PW);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

async function deletionCounts(email) {
  const encoded = encodeURIComponent(email);
  const results = await Promise.all([
    sbSelect('devfit_subscribers', 'email=eq.' + encoded + '&select=email'),
    sbSelect('devfit_data', 'email=eq.' + encoded + '&select=data_type'),
    sbSelect('devfit_data_versions', 'email=eq.' + encoded + '&select=id'),
    sbSelect('devfit_logins', 'email=eq.' + encoded + '&select=device_id')
  ]);
  if (results.some((rows) => !Array.isArray(rows))) return null;
  return {
    subscribers: results[0].length,
    currentData: results[1].length,
    recoveryVersions: results[2].length,
    devices: results[3].length
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!haveServerConfig() || !ADMIN_PW) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  // Throttle ONLY failed password guesses (10 wrong tries / 15 min per IP). A
  // correct password sails straight through, so a trainer doing normal work —
  // list, get, activate, tab-switching — is never rate-limited. (The old code
  // counted every authenticated action too, which locked the panel mid-use.)
  if (!pwOk(body.password)) {
    const rl = await rateLimit('admin_fail:' + clientIp(req), 10, 15 * 60);
    if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return; }
    res.status(401).json({ error: 'bad_password' });
    return;
  }

  const action = String(body.action || '');
  const email = String(body.email || '').trim().toLowerCase();

  try {
    if (action === 'list') {
      const rows = await sbSelect('devfit_subscribers', 'select=*&order=updated_at.desc');
      res.status(200).json({ subscribers: rows || [] });
      return;
    }

    if (action === 'logins') {
      // Every login/device across all users — who signed in, how many devices, when.
      res.status(200).json({ logins: await listLogins() });
      return;
    }

    if (action === 'errors') {
      const rows = await sbSelect('devfit_errors', 'select=*&order=at.desc&limit=100');
      res.status(200).json({ errors: rows || [] });
      return;
    }

    // Password-gated, whitelisted and paged. The server never accepts an
    // arbitrary table name, and the admin page encrypts every page into one
    // off-site backup before it is downloaded.
    if (action === 'backupPage') {
      const table = String(body.table || '');
      const order = BACKUP_TABLES[table];
      if (!order) { res.status(400).json({ error: 'bad_backup_table' }); return; }
      const offset = Math.max(0, Math.min(parseInt(body.offset || '0', 10) || 0, 10000000));
      const rows = await sbSelect(table,
        'select=*&order=' + encodeURIComponent(order) + '&offset=' + offset + '&limit=' + BACKUP_PAGE_ROWS);
      if (!Array.isArray(rows)) { res.status(503).json({ error: 'backup_store_unavailable' }); return; }
      const page = [];
      let bytes = 2;
      for (const row of rows) {
        const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
        if (page.length && bytes + rowBytes > BACKUP_PAGE_BYTES) break;
        page.push(row);
        bytes += rowBytes;
      }
      const consumed = page.length;
      res.status(200).json({
        table,
        rows: page,
        nextOffset: offset + consumed,
        done: consumed === rows.length && rows.length < BACKUP_PAGE_ROWS
      });
      return;
    }

    if (action === 'deletePreview') {
      if (!email || !email.includes('@')) { res.status(400).json({ error: 'missing_email' }); return; }
      const counts = await deletionCounts(email);
      if (!counts) { res.status(503).json({ error: 'account_store_unavailable' }); return; }
      res.status(200).json({ email, counts });
      return;
    }

    if (action === 'deleteAccount') {
      const confirmEmail = String(body.confirmEmail || '').trim().toLowerCase();
      const confirmation = String(body.confirmation || '').trim();
      if (!email || !email.includes('@') || confirmEmail !== email || confirmation !== 'DELETE DEVFIT ACCOUNT') {
        res.status(400).json({ error: 'deletion_confirmation_mismatch' }); return;
      }
      const rl = await rateLimit('admin_delete:' + clientIp(req), 10, 24 * 60 * 60);
      if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return; }
      const deleted = await sbRpc('delete_devfit_account', { p_email: email });
      if (!deleted || deleted.email !== email) { res.status(500).json({ error: 'delete_failed' }); return; }
      const remaining = await deletionCounts(email);
      if (!remaining || Object.values(remaining).some((count) => count !== 0)) {
        res.status(500).json({ error: 'delete_verification_failed', remaining }); return;
      }
      res.status(200).json({ ok: true, deleted, remaining });
      return;
    }

    // ── Payment settings (DuitNow QR / WhatsApp / note) — trainer-editable ──
    if (action === 'getConfig') {
      const rows = await sbSelect('devfit_config', 'id=eq.1&select=*');
      res.status(200).json({ config: (Array.isArray(rows) && rows[0]) || {} });
      return;
    }
    if (action === 'setConfig') {
      const row = { id: 1, updated_at: new Date().toISOString() };
      if (typeof body.whatsapp === 'string') row.whatsapp = body.whatsapp.replace(/[^0-9]/g, '').slice(0, 20);
      if (typeof body.price === 'string') row.price = body.price.slice(0, 20);
      if (typeof body.qr === 'string') row.qr = body.qr.slice(0, 500000);   // cap ~500KB base64
      if (typeof body.note === 'string') row.note = body.note.slice(0, 500);
      const saved = await sbUpsert('devfit_config', row, 'id');
      if (!saved) { res.status(500).json({ error: 'save_failed' }); return; }
      res.status(200).json({ ok: true, config: Array.isArray(saved) ? saved[0] : saved });
      return;
    }

    if (action === 'get') {
      if (!email) { res.status(400).json({ error: 'missing_email' }); return; }
      res.status(200).json({ subscriber: await getSubscriber(email) });
      return;
    }

    if (!email || !email.includes('@')) { res.status(400).json({ error: 'missing_email' }); return; }
    const existing = await getSubscriber(email);
    const now = new Date();

    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s));

    let row;
    if (action === 'activate') {
      // Calendar window the trainer picks. start_date = first day of access,
      // expiry = last day of access (inclusive). Falls back to days if no end.
      let start = String(body.start || '').slice(0, 10);
      let end = String(body.end || '').slice(0, 10);
      if (!isDate(start)) start = ymd(now);
      if (!isDate(end)) {
        const days = Math.max(1, parseInt(body.days || '30', 10) || 30);
        end = ymd(addDays(new Date(start), days - 1)); // inclusive span
      }
      if (new Date(end) < new Date(start)) { res.status(400).json({ error: 'end_before_start' }); return; }
      row = {
        email,
        name: body.name || (existing && existing.name) || email.split('@')[0],
        tier: 'pro',
        approved: true,
        start_date: start,
        expiry: end,
        plan: body.plan || (existing && existing.plan) || 'Pro',
        updated_at: now.toISOString()
      };
    } else if (action === 'extend') {
      const days = Math.max(1, parseInt(body.days || '30', 10) || 30);
      const base = (existing && existing.expiry && new Date(existing.expiry) > now) ? new Date(existing.expiry) : now;
      row = {
        email,
        name: (existing && existing.name) || email.split('@')[0],
        tier: 'pro', approved: true,
        expiry: ymd(addDays(base, days)),
        start_date: (existing && existing.start_date) || ymd(now),
        plan: (existing && existing.plan) || 'Pro',
        updated_at: now.toISOString()
      };
    } else if (action === 'deactivate') {
      row = { email, tier: 'free', approved: true, updated_at: now.toISOString() };
    } else if (action === 'revoke') {
      row = { email, approved: false, tier: 'free', updated_at: now.toISOString() };
    } else {
      res.status(400).json({ error: 'unknown_action' });
      return;
    }

    const saved = await sbUpsert('devfit_subscribers', row, 'email');
    if (!saved) { res.status(500).json({ error: 'save_failed' }); return; }
    res.status(200).json({ ok: true, subscriber: Array.isArray(saved) ? saved[0] : saved });
  } catch (e) {
    console.error('[DevFit admin]', String(e && e.message || e));
    res.status(500).json({ error: 'server_error' });
  }
}
