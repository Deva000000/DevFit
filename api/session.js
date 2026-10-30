// DevFit — POST /api/session
// Called right after login. Verifies the caller actually owns the email (via the
// a signed Google ID token), looks up their subscriber
// record, and — only if approved — returns a SERVER-SIGNED session token.
//
// The signed token is what the app stores instead of a plain "approved:true"
// flag: it cannot be forged in the browser without DEVFIT_JWT_SECRET.
//
// Body: { provider: 'google_id', token: <Google ID credential> }
// 200:  { approved:true, token, email, name, tier, expiry, startDate, plan }
//       { approved:false, status:'pending'|'denied' }

import crypto from 'crypto';
import {
  haveServerConfig, identityFromGoogleIdToken,
  getSubscriber, computeTier, signToken, rateLimit, clientIp, readJsonBody, sbInsertIgnore,
  recordServerEvent, setApiSecurityHeaders, sameOriginIfPresent, checkSecurityAccess,
  guardInvalidAuth, verifyToken, bearerToken, tokenDeviceMatches, sbRpc, sha256Hex, authorizeSession, denySession
} from './_lib.js';
import { setBrowserSession, readBrowserSession, clearBrowserSession } from './_browser-session.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }

  // Not configured yet → tell the client to fall back to its legacy path so the
  // live app keeps working while env vars are being set up.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);
  if (body.op === 'restore') {
    // Unlike explicit-bearer routes, this operation uses a cookie: require a
    // browser-origin header as well as the exact-origin check above (CSRF).
    if (!req.headers.origin && !req.headers.referer) { res.status(403).json({ error: 'origin' }); return; }
    const session = readBrowserSession(req);
    if (!session) { res.status(401).json({ error: 'sign_in_required' }); return; }
    const access = await authorizeSession(req, session, session.deviceId, '/api/verify');
    if (denySession(res, access)) return;
    const sub = access.subscriber, tier = computeTier(sub);
    const payload = { email: session.email, sid: session.sid, did: session.did, tier,
      expiry: sub.expiry || '', startDate: sub.start_date || '' };
    const browserContext = setBrowserSession(res, payload, session.deviceId);
    res.status(200).json({ approved: true, email: session.email, name: sub.name || session.email.split('@')[0],
      tier, expiry: sub.expiry || '', startDate: sub.start_date || '', plan: sub.plan || '',
      deviceId: session.deviceId, token: signToken(payload), browserContext }); return;
  }
  if (body.op === 'logout') {
    const session = verifyToken(bearerToken(req));
    if (!session?.email || !session.sid || !tokenDeviceMatches(session, body.deviceId)) {
      res.status(401).json({ error: 'invalid_session' }); return;
    }
    const result = await sbRpc('revoke_devfit_session', {
      p_email: session.email, p_device_id: body.deviceId, p_session_hash: sha256Hex(session.sid)
    });
    if (result?.status === 'ok') clearBrowserSession(req, res, session);
    res.status(result?.status === 'ok' ? 200 : 503).json({ ok: result?.status === 'ok' }); return;
  }
  const provider = String(body.provider || '').toLowerCase();
  const token = String(body.token || '');
  if (!token) { res.status(400).json({ error: 'missing_token' }); return; }

  // A shared IP is only an emergency ceiling. Thirty attempts blocked a whole
  // gym/campus/mobile-carrier NAT; verified-account limits below are the primary
  // anti-replay control.
  const ipRate = await rateLimit('session_ip:' + clientIp(req), 3000, 15 * 60, { failClosed: true, timeoutMs: 3000 });
  if (ipRate.unavailable) { res.status(503).json({ error: 'login_temporarily_unavailable' }); return; }
  if (!ipRate.ok) {
    res.setHeader('Retry-After', String(Math.max(1, ipRate.retryAfter || 1)));
    res.status(429).json({ error: 'rate_limited', retryAfter: ipRate.retryAfter }); return;
  }

  let email = null;
  let verifiedName = '';
  if (provider !== 'google_id') { res.status(400).json({ error: 'unsupported_provider' }); return; }
  const identity = await identityFromGoogleIdToken(token);
  email = identity && identity.email;
  verifiedName = identity && identity.name;
  if (!email) {
    await recordServerEvent('login_failure', 'Google identity verification failed', { page: '/api/session', status: 401, ua: req.headers['user-agent'] });
    const invalid = await guardInvalidAuth(req, '/api/session');
    if (invalid.blocked) {
      res.setHeader('Retry-After', String(invalid.retryAfter));
      res.status(invalid.unavailable ? 503 : 429).json({ error: invalid.unavailable ? 'login_temporarily_unavailable' : 'rate_limited' });
      return;
    }
    res.status(401).json({ error: 'invalid_identity' }); return;
  }

  const accountKey = crypto.createHash('sha256').update(email).digest('hex');
  const accountRate = await rateLimit('session_account:' + accountKey, 20, 15 * 60, { failClosed: true, timeoutMs: 3000 });
  if (accountRate.unavailable) { res.status(503).json({ error: 'login_temporarily_unavailable' }); return; }
  if (!accountRate.ok) {
    res.setHeader('Retry-After', String(Math.max(1, accountRate.retryAfter || 1)));
    res.status(429).json({ error: 'rate_limited', retryAfter: accountRate.retryAfter }); return;
  }

  // Check explicit blocks before account provisioning, without counting stale
  // installations as sessions. Registration/replacement is atomic below.
  const security = await checkSecurityAccess(req, email, body.deviceId, {
    route: '/api/session', register: false
  });
  if (security.status === 'unavailable') {
    res.status(503).json({ error: 'login_temporarily_unavailable' }); return;
  }
  if (security.status !== 'ok') {
    const limited = security.status === 'device_limit';
    res.status(403).json({
      error: limited ? 'device_limit' : security.status === 'invalid_device' ? 'device_storage_unavailable' : 'account_blocked',
      maxDevices: limited ? 3 : undefined
    });
    return;
  }

  // OPEN SIGNUP: DevFit is free to join. Any verified email that has no record yet
  // is auto-provisioned a Free account, so anyone can sign in. Pro is the paid
  // upgrade the trainer activates from admin.html. A row only becomes non-approved
  // when the trainer explicitly revokes/bans it — those stay locked out.
  let sub = await getSubscriber(email);
  if (typeof sub === 'undefined') {
    await recordServerEvent('login_failure', 'Account store unavailable during login', { page: '/api/session', status: 503 });
    res.status(503).json({ error: 'account_store_unavailable' });
    return;
  }
  if (!sub) {
    const created = await sbInsertIgnore(
      'devfit_subscribers',
      { email, name: verifiedName || email.split('@')[0], tier: 'free', approved: true, updated_at: new Date().toISOString() },
      'email'
    );
    // A concurrent owner activation/revocation or another login may have won
    // the insert. Never upsert "free/approved" over that authoritative row.
    sub = created ? await getSubscriber(email) : null;
    if (!sub) {
      await recordServerEvent('login_failure', 'Account creation failed', { page: '/api/session', status: 503 });
      res.status(503).json({ error: 'account_create_failed' }); return;
    }
  }
  if (!sub.approved) { res.status(200).json({ approved: false, status: 'pending' }); return; }

  const tier = computeTier(sub);
  const sid = crypto.randomBytes(32).toString('hex');
  const opened = await sbRpc('start_devfit_account_session', {
    p_email: email, p_device_id: body.deviceId, p_session_hash: sha256Hex(sid),
    p_ip_hash: sha256Hex(clientIp(req)), p_user_agent: String(req.headers['user-agent'] || '').slice(0,300)
  }, 5000);
  if (!opened) { res.status(503).json({ error: 'session_store_unavailable' }); return; }
  if (denySession(res, opened)) return;
  const signed = signToken({ email, sid, did: security.deviceHash, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });
  const browserContext = setBrowserSession(res, { email, sid, did: security.deviceHash }, body.deviceId);

  res.status(200).json({
    approved: true,
    token: signed,
    browserContext,
    email,
    name: sub.name || verifiedName || email.split('@')[0],
    tier,
    expiry: sub.expiry || '',
    startDate: sub.start_date || '',
    plan: sub.plan || ''
  });
}
