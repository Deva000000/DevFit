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
  haveServerConfig, verifyToken, getSubscriber, computeTier, signToken, readJsonBody,
  recordServerEvent, bearerToken, setApiSecurityHeaders, sameOriginIfPresent,
  checkSecurityAccess, tokenDeviceMatches, guardInvalidAuth, recordDeviceMismatch
} from './_lib.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }

  // Not configured → 501 so the client falls back to trusting its cached session
  // (transition mode). No user is locked out before env vars are set.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  const payload = verifyToken(bearerToken(req) || body.token);
  if (!payload || !payload.email) {
    const invalid = await guardInvalidAuth(req, '/api/verify');
    if (invalid.blocked) {
      res.setHeader('Retry-After', String(invalid.retryAfter));
      res.status(invalid.unavailable ? 503 : 429).json({ error: invalid.unavailable ? 'verify_unavailable' : 'rate_limited' });
      return;
    }
    res.status(200).json({ approved: false, reason: 'invalid_token' });
    return;
  }

  if (!tokenDeviceMatches(payload, body.deviceId)) {
    await recordDeviceMismatch(req, payload.email, body.deviceId, '/api/verify');
    res.status(200).json({ approved: false, reason: 'invalid_device' }); return;
  }
  // Track only the identity proven by the signed token. This also upgrades old
  // unbound tokens without forcing legitimate installed PWAs to sign in again.
  const security = await checkSecurityAccess(req, payload.email, body.deviceId, {
    route: '/api/verify', register: true, isLogin: false
  });
  if (security.status === 'unavailable') {
    res.status(503).json({ error: 'account_store_unavailable' }); return;
  }
  if (security.status !== 'ok') {
    res.status(403).json({ approved: false, reason: security.status }); return;
  }

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
  const signed = signToken({ email: payload.email, did: security.deviceHash, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });

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
