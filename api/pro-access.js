// DevFit — POST /api/pro-access
// Action-time authorization for premium features. The browser's cached tier is
// never accepted as proof: each request validates the signed session token and
// re-reads the current subscriber record, including start/expiry dates.

import {
  haveServerConfig, verifyToken, getSubscriber, computeTier, signToken,
  recordServerEvent, bearerToken, setApiSecurityHeaders, sameOriginIfPresent,
  readJsonBody, checkSecurityAccess, tokenDeviceMatches, guardInvalidAuth, recordDeviceMismatch
} from './_lib.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }
  if (!haveServerConfig()) { res.status(503).json({ error: 'service_unavailable' }); return; }

  const body = await readJsonBody(req);
  const payload = verifyToken(bearerToken(req));
  const email = payload && String(payload.email || '').trim().toLowerCase();
  if (!email || email.length > 254) {
    const invalid = await guardInvalidAuth(req, '/api/pro-access');
    if (invalid.blocked) res.setHeader('Retry-After', String(invalid.retryAfter));
    res.status(invalid.blocked ? (invalid.unavailable ? 503 : 429) : 401)
      .json({ error: invalid.blocked ? (invalid.unavailable ? 'service_unavailable' : 'rate_limited') : 'invalid_token' });
    return;
  }

  let deviceHash = payload.did || '';
  const suppliedDevice = String(body.deviceId || '');
  if (payload.did || suppliedDevice.length >= 16) {
    if (!tokenDeviceMatches(payload, suppliedDevice)) {
      await recordDeviceMismatch(req, email, suppliedDevice, '/api/pro-access');
      res.status(401).json({ error: 'invalid_device' }); return;
    }
    const security = await checkSecurityAccess(req, email, suppliedDevice, {
      route: '/api/pro-access', register: true, isLogin: false
    });
    if (security.status === 'unavailable') { res.status(503).json({ error: 'service_unavailable' }); return; }
    if (security.status !== 'ok') { res.status(403).json({ error: security.status }); return; }
    deviceHash = security.deviceHash;
  }

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
  const token = signToken({ email, ...(deviceHash ? { did: deviceHash } : {}), tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });
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
