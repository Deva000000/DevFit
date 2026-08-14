// DevFit — shared serverless helpers (Layer 1 auth).
//
// Dependency-free on purpose: no package.json / build step, same as api/usda.js.
// Files whose name starts with "_" are NOT treated as routes by Vercel, so this
// is import-only. Exposes: signed-token (JWT/HS256) sign+verify, Supabase
// service-role REST helpers, identity verification, and a simple rate limiter.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   DEVFIT_JWT_SECRET      — long random string; signs session tokens
//   SUPABASE_SERVICE_KEY   — Supabase service-role key (server-only, bypasses RLS)
//   DEVFIT_ADMIN_PASSWORD  — trainer password for admin.html
//   SUPABASE_URL           — optional; defaults to the known project URL
//   SUPABASE_ANON_KEY      — optional; used to validate Supabase user tokens

import crypto from 'crypto';

export const SB_URL = process.env.SUPABASE_URL || 'https://zngberygrzpkhiqrrzwj.supabase.co';
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_oJSFEcVvsvbhPA_8mhUrGQ_JCrBddtn';
const JWT_SECRET = process.env.DEVFIT_JWT_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '94871311791-ql8k9lo0q9e1uq3ri98ghnfr1m187chh.apps.googleusercontent.com';

export function haveServerConfig() {
  return Boolean(SB_SERVICE && JWT_SECRET);
}

// ── Base64url ────────────────────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(JSON.stringify(obj)); }
function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); }

// ── Signed session token (JWT, HS256) ────────────────────────────────────────
export function signToken(payload, ttlSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const p = head + '.' + b64urlJson(body);
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(p).digest());
  return p + '.' + sig;
}

// Returns the payload if valid+unexpired, else null. Signature-checked with a
// timing-safe compare so a forged token can never be accepted.
export function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !JWT_SECRET) return null;
    const [h, p, s] = parts;
    const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest());
    const a = Buffer.from(s), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromB64url(p));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

// ── Supabase service REST (PostgREST) ────────────────────────────────────────
const sbHeaders = () => ({
  apikey: SB_SERVICE,
  Authorization: 'Bearer ' + SB_SERVICE,
  'Content-Type': 'application/json'
});

export async function sbSelect(table, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!r.ok) return null;
  return r.json();
}

// Plain insert (no conflict key). Returns the inserted rows, or null on any error
// — callers treat null as "not persisted" and never fail because of it.
export async function sbInsert(table, row) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    return r.ok ? true : null;
  } catch (e) { return null; }
}

export async function sbInsertReturning(table, row) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(row)
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

export async function sbPatch(table, query, changes) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(changes)
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

export async function sbUpsert(table, row, onConflict) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  if (!r.ok) return null;
  return r.json();
}

// ── Identity verification (proves the caller owns the email) ─────────────────
// Supabase magic-link session token → email.
export async function emailFromSupabaseToken(accessToken) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: 'Bearer ' + accessToken }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.email) ? String(u.email).toLowerCase() : null;
  } catch (e) { return null; }
}

// Google OAuth access token → email (must be verified).
export async function emailFromGoogleToken(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.email || u.email_verified === false) return null;
    return String(u.email).toLowerCase();
  } catch (e) { return null; }
}

// Google Identity Services ID credential -> verified identity. Unlike the old
// access-token/userinfo flow, this verifies the signed JWT itself: signature,
// issuer, audience and lifetime. Google's public signing keys rotate, so cache
// them only for the duration advertised by Google's Cache-Control header.
let googleJwks = null;
let googleJwksUntil = 0;

async function getGoogleJwk(kid) {
  const hadFreshCache = Boolean(googleJwks && Date.now() < googleJwksUntil);
  if (!googleJwks || Date.now() >= googleJwksUntil) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { cache: 'no-store' });
    if (!r.ok) return null;
    const body = await r.json();
    googleJwks = Array.isArray(body.keys) ? body.keys : [];
    const cc = r.headers && r.headers.get ? (r.headers.get('cache-control') || '') : '';
    const maxAge = Number((cc.match(/max-age=(\d+)/i) || [])[1] || 3600);
    googleJwksUntil = Date.now() + Math.max(60, Math.min(maxAge, 86400)) * 1000;
  }
  const found = googleJwks.find((key) => key && key.kid === kid) || null;
  // A new signing key can appear before our cached max-age elapses. Refresh once
  // on an unknown kid so key rotation never locks legitimate users out.
  if (!found && hadFreshCache) {
    googleJwks = null;
    googleJwksUntil = 0;
    return getGoogleJwk(kid);
  }
  return found;
}

export async function identityFromGoogleIdToken(idToken) {
  try {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(fromB64url(parts[0]));
    const claims = JSON.parse(fromB64url(parts[1]));
    if (header.alg !== 'RS256' || !header.kid) return null;
    const jwk = await getGoogleJwk(header.kid);
    if (!jwk) return null;
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, signature);
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    const audienceOk = Array.isArray(claims.aud)
      ? claims.aud.includes(GOOGLE_CLIENT_ID)
      : claims.aud === GOOGLE_CLIENT_ID;
    if (!issuerOk || !audienceOk || Number(claims.exp || 0) < now - 30) return null;
    if (Number(claims.iat || 0) > now + 120) return null;
    if (!claims.sub || !claims.email || claims.email_verified !== true) return null;
    return {
      email: String(claims.email).trim().toLowerCase(),
      name: String(claims.name || claims.given_name || '').trim(),
      subject: String(claims.sub)
    };
  } catch (e) { return null; }
}

// ── Subscriber lookup + tier computation ─────────────────────────────────────
export async function getSubscriber(email) {
  const rows = await sbSelect('devfit_subscribers', 'email=eq.' + encodeURIComponent(email) + '&select=*');
  return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
}

// Authoritative tier: Free unless approved AND today is within [start_date, expiry].
// The plan is a calendar window the trainer sets. Access begins on start_date and
// runs through the WHOLE expiry day (ends exactly at the start of the next day —
// not early, not late). Dates are UTC-day compared so it's identical everywhere.
export function computeTier(sub) {
  if (!sub || !sub.approved) return 'free';
  const t = String(sub.tier || 'free').toLowerCase();
  if (t !== 'pro') return t;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Not started yet → still Free until the start date arrives.
  if (sub.start_date) {
    const st = new Date(sub.start_date);
    if (!isNaN(st)) { st.setHours(0, 0, 0, 0); if (st > today) return 'free'; }
  }
  // Past the end (expiry) day → expired. accessEnd = expiry + 1 day (inclusive end).
  if (sub.expiry) {
    const exp = new Date(sub.expiry);
    if (!isNaN(exp)) {
      const accessEnd = new Date(exp); accessEnd.setHours(0, 0, 0, 0); accessEnd.setDate(accessEnd.getDate() + 1);
      if (accessEnd <= today) return 'free';
    }
  }
  return 'pro';
}

// ── Login / device tracking ──────────────────────────────────────────────────
// One row per (email, device) so the trainer can see who logged in and on how
// many devices. isLogin=true (a real sign-in) bumps login_count; isLogin=false
// (a background page-load re-verify) only refreshes last_seen so the count stays
// meaningful. Non-fatal: a tracking failure never blocks auth.
export async function recordLogin(email, deviceId, userAgent, isLogin = true) {
  try {
    if (!email) return;
    const dev = String(deviceId || 'unknown').slice(0, 80);
    const ua = String(userAgent || '').slice(0, 300);
    const now = new Date().toISOString();
    const rows = await sbSelect('devfit_logins',
      'email=eq.' + encodeURIComponent(email) + '&device_id=eq.' + encodeURIComponent(dev) + '&select=*');
    const existing = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    const row = {
      email, device_id: dev, user_agent: ua, last_seen: now,
      first_seen: existing ? existing.first_seen : now,
      login_count: existing ? ((existing.login_count || 1) + (isLogin ? 1 : 0)) : 1
    };
    await sbUpsert('devfit_logins', row, 'email,device_id');
  } catch (e) { /* tracking is best-effort */ }
}

export async function listLogins() {
  const rows = await sbSelect('devfit_logins', 'select=*&order=last_seen.desc');
  return rows || [];
}

// ── Rate limiter (Supabase-backed; reliable across serverless instances) ─────
// Returns { ok:true } or { ok:false, retryAfter }. Fails OPEN if the store is
// unreachable so a DB hiccup never locks out the trainer.
export async function rateLimit(id, limit, windowSeconds) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = await sbSelect('devfit_rate', 'id=eq.' + encodeURIComponent(id) + '&select=*');
    const row = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    let hits = 1, resetAt = now + windowSeconds;
    if (row && row.reset_at > now) {
      hits = (row.hits || 0) + 1;
      resetAt = row.reset_at;
      if (hits > limit) return { ok: false, retryAfter: resetAt - now };
    }
    await sbUpsert('devfit_rate', { id, hits, reset_at: resetAt }, 'id');
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

// ── Same-origin guard for the public food-search proxies ─────────────────────
// The USDA/OFF/Kalori proxies take no auth (they must work for logged-out users
// on the pricing/landing pages too), so they were wide-open — anyone could script
// them and run up Vercel invocations + upstream quota. A legit in-app fetch is
// always same-origin, so its Referer/Origin host equals this deployment's own Host.
// A scripted curl from elsewhere has a foreign host or none → blocked. Zero added
// latency (header check only), so it stays off the hot search path's critical path.
export function sameSiteOnly(req) {
  try {
    const host = String((req.headers && req.headers['host']) || '').toLowerCase();
    const ref = String((req.headers && (req.headers['referer'] || req.headers['origin'])) || '').toLowerCase();
    if (!ref || !host) return false;
    const refHost = new URL(ref).host.toLowerCase();
    return refHost === host || refHost === 'localhost' || refHost.startsWith('localhost:');
  } catch (e) { return false; }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || 'unknown';
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
