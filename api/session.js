// DevFit — POST /api/session
// Called right after login. Verifies the caller actually owns the email (via the
// Supabase magic-link token or a Google OAuth token), looks up their subscriber
// record, and — only if approved — returns a SERVER-SIGNED session token.
//
// The signed token is what the app stores instead of a plain "approved:true"
// flag: it cannot be forged in the browser without DEVFIT_JWT_SECRET.
//
// Body: { provider: 'supabase' | 'google', token: <providerAccessToken> }
// 200:  { approved:true, token, email, name, tier, expiry, startDate, plan }
//       { approved:false, status:'pending'|'denied' }

import {
  haveServerConfig, emailFromSupabaseToken, emailFromGoogleToken,
  getSubscriber, computeTier, signToken, rateLimit, clientIp, readJsonBody
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
  if (provider === 'google') email = await emailFromGoogleToken(token);
  else email = await emailFromSupabaseToken(token);
  if (!email) { res.status(401).json({ error: 'invalid_identity' }); return; }

  const sub = await getSubscriber(email);
  if (!sub) { res.status(200).json({ approved: false, status: 'denied' }); return; }
  if (!sub.approved) { res.status(200).json({ approved: false, status: 'pending' }); return; }

  const tier = computeTier(sub);
  const signed = signToken({ email, tier, expiry: sub.expiry || '' });

  res.status(200).json({
    approved: true,
    token: signed,
    email,
    name: sub.name || email.split('@')[0],
    tier,
    expiry: sub.expiry || '',
    startDate: sub.start_date || '',
    plan: sub.plan || ''
  });
}
