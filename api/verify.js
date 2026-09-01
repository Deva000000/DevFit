// DevFit — POST /api/verify
// Called on every app page load. Validates the signed session token (signature
// + integrity), then RE-READS the subscriber row so revocation and plan expiry
// are live. Returns the authoritative tier and a freshly-signed persistent token
// so the user stays logged in until manual logout or account revocation.
//
// This is what defeats forged localStorage: a hand-made session has no valid
// token, so verify returns approved:false and the client kicks it to login.
//
// Body: { token }
// 200:  { approved:true, token, email, name, tier, expiry, startDate, plan }
//       { approved:false, reason }

import {
  haveServerConfig, verifyToken, getSubscriber, computeTier, signToken, readJsonBody, recordLogin,
  recordServerEvent
} from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // Not configured → 501 so the client falls back to trusting its cached session
  // (transition mode). No user is locked out before env vars are set.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  const payload = verifyToken(body.token);
  if (!payload || !payload.email) {
    res.status(200).json({ approved: false, reason: 'invalid_token' });
    return;
  }

  // Track only the identity proven by the signed token. Never trust the email in
  // the request body, otherwise an attacker can pollute the device table with
  // arbitrary addresses even though they cannot gain account access.
  await recordLogin(payload.email, body.deviceId, req.headers['user-agent'], false);

  const sub = await getSubscriber(payload.email);
  if (typeof sub === 'undefined') {
    await recordServerEvent('verify_failure', 'Account store unavailable during verification', { page: '/api/verify', status: 503 });
    res.status(503).json({ error: 'account_store_unavailable' });
    return;
  }
  if (!sub || !sub.approved) {
    res.status(200).json({ approved: false, reason: 'revoked' });
    return;
  }

  const tier = computeTier(sub);
  const signed = signToken({ email: payload.email, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });

  res.status(200).json({
    approved: true,
    token: signed,
    email: payload.email,
    name: sub.name || payload.email.split('@')[0],
    tier,
    expiry: sub.expiry || '',
    startDate: sub.start_date || '',
    plan: sub.plan || ''
  });
}
