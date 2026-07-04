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
  rateLimit, clientIp, readJsonBody
} from './_lib.js';

const ADMIN_PW = process.env.DEVFIT_ADMIN_PASSWORD || '';

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!haveServerConfig() || !ADMIN_PW) { res.status(501).json({ error: 'not_configured' }); return; }

  // Rate limit BEFORE checking the password so guessing is throttled: 8 tries / 15 min per IP.
  const rl = await rateLimit('admin:' + clientIp(req), 8, 15 * 60);
  if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return; }

  const body = await readJsonBody(req);
  if (String(body.password || '') !== ADMIN_PW) { res.status(401).json({ error: 'bad_password' }); return; }

  const action = String(body.action || '');
  const email = String(body.email || '').trim().toLowerCase();

  try {
    if (action === 'list') {
      const rows = await sbSelect('devfit_subscribers', 'select=*&order=updated_at.desc');
      res.status(200).json({ subscribers: rows || [] });
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

    let row;
    if (action === 'activate') {
      const days = Math.max(1, parseInt(body.days || '30', 10) || 30);
      row = {
        email,
        name: body.name || (existing && existing.name) || email.split('@')[0],
        tier: 'pro',
        approved: true,
        expiry: ymd(addDays(now, days)),
        start_date: (existing && existing.start_date) || ymd(now),
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
