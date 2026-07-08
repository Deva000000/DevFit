// DevFit — POST /api/verify
// Called on every app page load. Validates the signed session token (signature
// + expiry), then RE-READS the subscriber row so revocation and plan expiry are
// live. Returns the authoritative tier and a freshly-signed token (sliding
// window) so a long-active user stays logged in without re-authenticating.
//
// This is what defeats forged localStorage: a hand-made session has no valid
// token, so verify returns approved:false and the client kicks it to login.
//
// Body: { token }
// 200:  { approved:true, token, email, name, tier, expiry, startDate, plan }
//       { approved:false, reason }

import {
  haveServerConfig, verifyToken, getSubscriber, computeTier, signToken, readJsonBody, recordLogin
} from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // Not configured → 501 so the client falls back to trusting its cached session
  // (transition mode). No user is locked out before env vars are set.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  // VISIBILITY TRACKING — record every active device for anyone with a session,
  // BEFORE the token check. This captures users who logged in before the signed-
  // token system (cached session, no token) and pending/free users too, so the
  // trainer's "Logins & Devices" tab shows everyone who's actually using the app,
  // not just freshly-authenticated ones. Tracking never grants access, so the
  // client-known email is acceptable. isLogin=false → refresh last-seen only.
  if (body.email && String(body.email).includes('@')) {
    await recordLogin(String(body.email).toLowerCase(), body.deviceId, req.headers['user-agent'], false);
  }

  const payload = verifyToken(body.token);
  if (!payload || !payload.email) {
    res.status(200).json({ approved: false, reason: 'invalid_token' });
    return;
  }

  const sub = await getSubscriber(payload.email);
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
