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

// ── Subscriber lookup + tier computation ─────────────────────────────────────
export async function getSubscriber(email) {
  const rows = await sbSelect('devfit_subscribers', 'email=eq.' + encodeURIComponent(email) + '&select=*');
  return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
}

// Authoritative tier: Free unless approved AND (no expiry OR expiry not passed).
// Access runs through the whole expiry day (same rule as the client).
export function computeTier(sub) {
  if (!sub || !sub.approved) return 'free';
  const t = String(sub.tier || 'free').toLowerCase();
  if (t !== 'pro') return t;
  if (sub.expiry) {
    const exp = new Date(sub.expiry);
    if (!isNaN(exp)) {
      const accessEnd = new Date(exp); accessEnd.setHours(0, 0, 0, 0); accessEnd.setDate(accessEnd.getDate() + 1);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (accessEnd <= today) return 'free';
    }
  }
  return 'pro';
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
