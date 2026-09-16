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
  getSubscriber, computeTier, signToken, rateLimit, clientIp, readJsonBody, recordLogin, sbUpsert,
  recordServerEvent, setApiSecurityHeaders, sameOriginIfPresent
} from './_lib.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }

  // Not configured yet → tell the client to fall back to its legacy path so the
  // live app keeps working while env vars are being set up.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);
  const provider = String(body.provider || '').toLowerCase();
  const token = String(body.token || '');
  if (!token) { res.status(400).json({ error: 'missing_token' }); return; }

  // A shared IP is only an emergency ceiling. Thirty attempts blocked a whole
  // gym/campus/mobile-carrier NAT; verified-account limits below are the primary
  // anti-replay control.
  const ipRate = await rateLimit('session_ip:' + clientIp(req), 300, 15 * 60, { failClosed: true, timeoutMs: 3000 });
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
    res.status(401).json({ error: 'invalid_identity' }); return;
  }

  const accountKey = crypto.createHash('sha256').update(email).digest('hex');
  const accountRate = await rateLimit('session_account:' + accountKey, 20, 15 * 60, { failClosed: true, timeoutMs: 3000 });
  if (accountRate.unavailable) { res.status(503).json({ error: 'login_temporarily_unavailable' }); return; }
  if (!accountRate.ok) {
    res.setHeader('Retry-After', String(Math.max(1, accountRate.retryAfter || 1)));
    res.status(429).json({ error: 'rate_limited', retryAfter: accountRate.retryAfter }); return;
  }

  // Record the login for every verified identity — including people who aren't
  // subscribers yet — so the trainer has full visibility of who signed in and
  // from which device (two phones / phone+tablet+laptop all show up).
  await recordLogin(email, body.deviceId, req.headers['user-agent'], true);

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
    const created = await sbUpsert(
      'devfit_subscribers',
      { email, name: verifiedName || email.split('@')[0], tier: 'free', approved: true, updated_at: new Date().toISOString() },
      'email'
    );
    sub = (Array.isArray(created) ? created[0] : created) || null;
    if (!sub) {
      await recordServerEvent('login_failure', 'Account creation failed', { page: '/api/session', status: 503 });
      res.status(503).json({ error: 'account_create_failed' }); return;
    }
  }
  if (!sub.approved) { res.status(200).json({ approved: false, status: 'pending' }); return; }

  const tier = computeTier(sub);
  const signed = signToken({ email, tier, expiry: sub.expiry || '', startDate: sub.start_date || '' });

  res.status(200).json({
    approved: true,
    token: signed,
    email,
    name: sub.name || verifiedName || email.split('@')[0],
    tier,
    expiry: sub.expiry || '',
    startDate: sub.start_date || '',
    plan: sub.plan || ''
  });
}
