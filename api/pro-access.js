// DevFit — POST /api/pro-access
// Action-time authorization for premium features. The browser's cached tier is
// never accepted as proof: each request validates the signed session token and
// re-reads the current subscriber record, including start/expiry dates.

import {
  haveServerConfig, verifyToken, getSubscriber, computeTier, signToken,
  recordServerEvent
} from './_lib.js';

function bearerToken(req) {
  const raw = String((req.headers && req.headers.authorization) || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!haveServerConfig()) { res.status(503).json({ error: 'service_unavailable' }); return; }

  const payload = verifyToken(bearerToken(req));
  const email = payload && String(payload.email || '').trim().toLowerCase();
  if (!email || email.length > 254) { res.status(401).json({ error: 'invalid_token' }); return; }

  const sub = await getSubscriber(email, 5000);
  if (typeof sub === 'undefined') {
    await recordServerEvent('pro_access_failure', 'Account store unavailable during Pro authorization', {
      page: '/api/pro-access', status: 503
    });
    res.status(503).json({ error: 'account_store_unavailable' });
    return;
  }
  if (!sub || !sub.approved) { res.status(401).json({ error: 'revoked' }); return; }

  const tier = computeTier(sub);
  const token = signToken({ email, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });
  const account = {
    tier,
    token,
    expiry: sub.expiry || '',
    startDate: sub.start_date || '',
    plan: sub.plan || '',
    name: sub.name || email.split('@')[0]
  };
  if (tier !== 'pro') {
    res.status(403).json({ authorized: false, error: 'pro_required', ...account });
    return;
  }

  res.status(200).json({ authorized: true, ...account });
}
