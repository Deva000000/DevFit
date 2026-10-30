// Upgrade old installed sessions once, then enforce a finite, revocable session.
import {
  haveServerConfig, verifyToken, computeTier, signToken, readJsonBody,
  bearerToken, setApiSecurityHeaders, sameOriginIfPresent, checkSecurityAccess,
  tokenDeviceMatches, guardInvalidAuth, authorizeSession, denySession, openSession, sha256Hex
} from './_lib.js';
import { setBrowserSession } from './_browser-session.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }
  if (!haveServerConfig()) { res.status(503).json({ error: 'service_unavailable' }); return; }
  const body = await readJsonBody(req);
  const payload = verifyToken(bearerToken(req) || body.token, { allowLegacy: true });
  if (!payload?.email) {
    const invalid = await guardInvalidAuth(req, '/api/verify');
    if (invalid.blocked) res.setHeader('Retry-After', String(invalid.retryAfter));
    res.status(invalid.blocked ? 429 : 200).json({ approved: false, reason: 'invalid_token' }); return;
  }
  if (payload.did && !tokenDeviceMatches(payload, body.deviceId)) {
    res.status(200).json({ approved: false, reason: 'invalid_device' }); return;
  }
  // Compatibility is restricted to this route and a seven-day DB window.
  // Never re-register a device: reset/logout must remain effective.
  if (!payload.sid) {
    const security = await checkSecurityAccess(req, payload.email, body.deviceId, {
      route: '/api/verify', requireKnown: true
    });
    if (denySession(res, security)) return;
    const opened = await openSession(payload.email, body.deviceId, payload.iat, true);
    if (opened.status === 'unavailable') { res.status(503).json({error:'session_store_unavailable'});return; }
    if (opened.status !== 'ok') { res.status(200).json({ approved: false, reason: 'sign_in_required' }); return; }
    payload.sid = opened.sid;
    payload.did = sha256Hex(body.deviceId);
  }
  const access = await authorizeSession(req, payload, body.deviceId, '/api/verify');
  if (denySession(res, access)) return;
  const sub = access.subscriber;
  const tier = computeTier(sub);
  const browserContext = setBrowserSession(res, payload, body.deviceId);
  res.status(200).json({
    approved: true, email: payload.email, tier,
    browserContext,
    token: signToken({ email: payload.email, sid: payload.sid, did: payload.did, tier,
      expiry: sub.expiry || '', startDate: sub.start_date || '' }),
    name: sub.name || payload.email.split('@')[0], expiry: sub.expiry || '',
    startDate: sub.start_date || '', plan: sub.plan || ''
  });
}
