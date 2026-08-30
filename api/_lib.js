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

import crypto from 'crypto';

export const SB_URL = process.env.SUPABASE_URL || 'https://zngberygrzpkhiqrrzwj.supabase.co';
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
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
export function signToken(payload, ttlSeconds = null) {
  const now = Math.floor(Date.now() / 1000);
  // DevFit sessions intentionally persist until the user logs out (or the
  // trainer revokes the account). Google proves the email once at sign-in; this
  // signed server token is then re-checked against the subscriber row on every
  // online app load. A finite TTL can still be requested explicitly for tests or
  // one-off server uses, but normal app sessions do not expire with time.
  const body = { ...payload, iat: now };
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) body.exp = now + ttlSeconds;
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
    // Legacy DevFit tokens carried a seven-day exp. Accepting their valid
    // signature lets /api/verify replace them with the new persistent token
    // without forcing every existing client to sign in once more.
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

export async function sbRpc(name, args) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(args || {})
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

// Insert a row once without turning a duplicate into a database error. Useful
// for best-effort recovery snapshots, where the content hash is the identity.
export async function sbInsertIgnore(table, row, onConflict) {
  try {
    const suffix = onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '';
    const r = await fetch(`${SB_URL}/rest/v1/${table}${suffix}`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row)
    });
    return r.ok ? true : null;
  } catch (e) { return null; }
}

// Admin credentials are exchanged once for a short-lived, HttpOnly cookie.
// Keeping the password out of page-level JavaScript prevents an unrelated UI
// bug or browser extension from reading and replaying the owner password.
export function signAdminSession() {
  return signToken({ kind: 'devfit_admin' }, 12 * 60 * 60);
}

export function verifyAdminSession(token) {
  const payload = verifyToken(token);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.kind !== 'devfit_admin') return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
  return payload;
}

export function cookieValue(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  const prefix = String(name || '') + '=';
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      try { return decodeURIComponent(item.slice(prefix.length)); } catch (_) { return ''; }
    }
  }
  return '';
}

// Durable production event reporting. Always write to Vercel logs and, when the
// server database is available, retain the event in devfit_errors. This helper
// never throws back into a user request.
export async function recordServerEvent(type, message, details = {}) {
  const rec = {
    type: String(type || 'server').slice(0, 20),
    message: String(message || '').slice(0, 500),
    stack: String(details.stack || '').slice(0, 1500),
    src: String(details.src || '').slice(0, 200),
    page: String(details.page || '').slice(0, 120),
    ua: String(details.ua || '').slice(0, 200),
    status: Number.isFinite(details.status) ? details.status : null,
    at: new Date().toISOString()
  };
  try { console.error('[DevFit monitor]', JSON.stringify(rec)); } catch (_) {}
  try {
    if (haveServerConfig()) {
      // This RPC inserts and bounds retained monitoring rows atomically. Fall
      // back during a staggered deploy so monitoring cannot break a user call.
      const stored = await sbRpc('record_devfit_error', {
        p_type: rec.type, p_message: rec.message, p_stack: rec.stack,
        p_src: rec.src, p_page: rec.page, p_ua: rec.ua, p_status: rec.status
      });
      if (stored === null) await sbInsert('devfit_errors', rec);
    }
  } catch (_) {}
}

// ── Identity verification (proves the caller owns the email) ─────────────────
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
  // undefined = backend unavailable; null = lookup succeeded with no account.
  // Callers must not confuse a temporary outage with a revoked account.
  if (rows === null) return undefined;
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
// The database RPC increments atomically, so simultaneous serverless invocations
// cannot all observe the same old hit count.
export async function rateLimit(id, limit, windowSeconds) {
  try {
    const result = await sbRpc('consume_devfit_rate_limit', {
      p_id: String(id || '').slice(0, 180),
      p_limit: Math.max(1, Math.floor(Number(limit) || 1)),
      p_window_seconds: Math.max(1, Math.floor(Number(windowSeconds) || 1))
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row.allowed !== 'boolean') return { ok: true, unavailable: true };
    return { ok: row.allowed, retryAfter: Math.max(0, Number(row.retry_after) || 0) };
  } catch (e) { return { ok: true, unavailable: true }; }
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
  const headers = (req && req.headers) || {};
  const xff = headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req && req.socket && req.socket.remoteAddress || 'unknown';
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
