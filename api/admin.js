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

import {
  haveServerConfig, sbSelect, sbUpsert, getSubscriber,
  rateLimit, clientIp, readJsonBody, listLogins
} from './_lib.js';

const ADMIN_PW = process.env.DEVFIT_ADMIN_PASSWORD || '';

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!haveServerConfig() || !ADMIN_PW) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  // Throttle ONLY failed password guesses (10 wrong tries / 15 min per IP). A
  // correct password sails straight through, so a trainer doing normal work —
  // list, get, activate, tab-switching — is never rate-limited. (The old code
  // counted every authenticated action too, which locked the panel mid-use.)
  if (String(body.password || '') !== ADMIN_PW) {
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
    res.status(500).json({ error: 'server_error', detail: String(e && e.message || e) });
  }
}
