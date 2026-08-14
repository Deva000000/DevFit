// DevFit — POST /api/session
// Called right after login. Verifies the caller actually owns the email (via the
// Supabase email-code token or a Google ID token), looks up their subscriber
// record, and — only if approved — returns a SERVER-SIGNED session token.
//
// The signed token is what the app stores instead of a plain "approved:true"
// flag: it cannot be forged in the browser without DEVFIT_JWT_SECRET.
//
// Body: { provider: 'supabase' | 'google_id', token: <providerToken> }
// 200:  { approved:true, token, email, name, tier, expiry, startDate, plan }
//       { approved:false, status:'pending'|'denied' }

import {
  haveServerConfig, emailFromSupabaseToken, emailFromGoogleToken, identityFromGoogleIdToken,
  getSubscriber, computeTier, signToken, rateLimit, clientIp, readJsonBody, recordLogin, sbUpsert
} from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // Not configured yet → tell the client to fall back to its legacy path so the
  // live app keeps working while env vars are being set up.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);
  const provider = String(body.provider || '').toLowerCase();
  const token = String(body.token || '');
  if (!token) { res.status(400).json({ error: 'missing_token' }); return; }

  // Throttle by IP so a stolen provider token can't be replayed at high volume.
  const rl = await rateLimit('session:' + clientIp(req), 30, 15 * 60);
  if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return; }

  let email = null;
  let verifiedName = '';
  if (provider === 'google_id') {
    const identity = await identityFromGoogleIdToken(token);
    email = identity && identity.email;
    verifiedName = identity && identity.name;
  } else if (provider === 'google') {
    // Temporary compatibility for a rolling deploy: old cached login pages still
    // send an OAuth access token. New clients always use google_id.
    email = await emailFromGoogleToken(token);
  } else if (provider === 'supabase') {
    email = await emailFromSupabaseToken(token);
  }
  if (!email) { res.status(401).json({ error: 'invalid_identity' }); return; }

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
    if (!sub) { res.status(503).json({ error: 'account_create_failed' }); return; }
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
