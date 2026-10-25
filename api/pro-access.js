// DevFit — POST /api/pro-access
// Action-time authorization for premium features. The browser's cached tier is
// never accepted as proof: each request validates the signed session token and
// re-reads the current subscriber record, including start/expiry dates.

import {
  haveServerConfig, verifyToken, computeTier, signToken,
  recordServerEvent, bearerToken, setApiSecurityHeaders, sameOriginIfPresent,
  readJsonBody, guardInvalidAuth,
  authorizeSession, denySession
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

  const access = await authorizeSession(req, payload, body.deviceId, '/api/pro-access');
  if (denySession(res, access)) return;
  const deviceHash = payload.did;

  const sub = access.subscriber;
  if (typeof sub === 'undefined') {
    await recordServerEvent('pro_access_failure', 'Account store unavailable during Pro authorization', {
      page: '/api/pro-access', status: 503
    });
    res.status(503).json({ error: 'account_store_unavailable' });
    return;
  }
  if (!sub || !sub.approved) { res.status(401).json({ error: 'revoked' }); return; }

  const tier = computeTier(sub);
  const token = signToken({ email, sid: payload.sid, did: deviceHash, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });
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

  if (body.action && body.action !== 'authorize') {
    if (!['progress_pdf','workout_pdf','nutrition_pdf'].includes(body.action)) {
      res.status(400).json({ error: 'unknown_premium_action' }); return;
    }
    // Load the heavier renderer only AFTER current account authorization.
    const { handlePremiumPdf } = await import('./_premium-pdf.js');
    await handlePremiumPdf(req,res,email,sub,body); return;
  }

  res.status(200).json({ authorized: true, ...account });
}
