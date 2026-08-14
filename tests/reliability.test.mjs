import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const CLIENT_ID = '94871311791-ql8k9lo0q9e1uq3ri98ghnfr1m187chh.apps.googleusercontent.com';

function b64(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

test('Google ID tokens require a valid signature, audience and lifetime', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] }),
    headers: { get: () => 'public, max-age=3600' }
  });
  const { identityFromGoogleIdToken } = await import(new URL('../api/_lib.js?google-test', import.meta.url));
  const now = Math.floor(Date.now() / 1000);
  const make = (overrides = {}) => {
    const h = b64({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
    const p = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '123', email: 'Person@Gmail.com', email_verified: true, name: 'Person', iat: now, exp: now + 300, ...overrides });
    return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), pair.privateKey).toString('base64url');
  };
  assert.deepEqual(await identityFromGoogleIdToken(make()), { email: 'person@gmail.com', name: 'Person', subject: '123' });
  assert.equal(await identityFromGoogleIdToken(make({ aud: 'wrong-client' })), null);
  assert.equal(await identityFromGoogleIdToken(make({ exp: now - 300 })), null);
  const valid = make().split('.');
  const changedClaims = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '123', email: 'attacker@gmail.com', email_verified: true, iat: now, exp: now + 300 });
  assert.equal(await identityFromGoogleIdToken(valid[0] + '.' + changedClaims + '.' + valid[2]), null);
});

test('workout merge keeps sessions recorded independently on two devices', () => {
  const code = fs.readFileSync(new URL('../devfit-db.js', import.meta.url), 'utf8');
  const storage = new Map();
  const localStorage = { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const context = { localStorage, fetch: async () => ({ status: 501, ok: false }), console, setTimeout: () => 0, clearTimeout: () => {}, document: { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener: () => {} }, Map, Date, JSON, Object, Array, Number, String, Math };
  context.window = context;
  vm.runInNewContext(code, context);
  const a = { sessions: [{ date: '2026-08-01', workoutId: 'legs', logs: [{ name: 'Hamstring Curl', sets: [{ weight: 30, reps: 12 }] }] }] };
  const b = { sessions: [{ date: '2026-08-08', workoutId: 'legs', logs: [{ name: 'Hamstring Curl', sets: [{ weight: 35, reps: 10 }] }] }] };
  const merged = context.DevFitDB._merge('workouts', a, b);
  assert.equal(merged.sessions.length, 2);
  assert.deepEqual(Array.from(merged.sessions, (s) => s.date), ['2026-08-01', '2026-08-08']);

  const progressA = { programStart: '2026-08-03', bw: [[70, '', '', '', '', '', '']], steps: [[]], sleep: [[]], weeklyCheckin: [{}] };
  const progressB = { programStart: '2026-08-03', bw: [['', 69.8, '', '', '', '', '']], steps: [[]], sleep: [[]], weeklyCheckin: [{}] };
  const progress = context.DevFitDB._merge('progress', progressA, progressB);
  assert.equal(progress.bw[0][0], 70);
  assert.equal(progress.bw[0][1], 69.8);
});

test('data API rejects a stale whole-document write with the current row', async () => {
  process.env.DEVFIT_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const current = { data_type: 'workouts', data: { sessions: [{ date: '2026-08-08' }] }, updated_at: '2026-08-14T01:00:00.000Z' };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/rest/v1/devfit_data?')) return { ok: true, json: async () => [current] };
    throw new Error('A stale write must not reach a mutation');
  };
  const { default: handler } = await import(new URL('../api/data.js?conflict-test', import.meta.url));
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ email: 'person@gmail.com', exp: Math.floor(Date.now() / 1000) + 300 });
  const signature = crypto.createHmac('sha256', 'test-secret').update(header + '.' + payload).digest().toString('base64url');
  const req = { method: 'POST', body: { token: header + '.' + payload + '.' + signature, op: 'set', dataType: 'workouts', data: { sessions: [] }, baseUpdatedAt: '2026-08-13T01:00:00.000Z' } };
  let status = 0, body;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } };
  await handler(req, res);
  assert.equal(status, 409);
  assert.equal(body.error, 'conflict');
  assert.deepEqual(body.row, current);
});

test('login uses ID credentials and has no redirect-based email or sales panel', () => {
  const html = fs.readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.match(html, /google\.accounts\.id\.initialize/);
  assert.match(html, /finishLogin\('google_id'/);
  assert.doesNotMatch(html, /initTokenClient|emailRedirectTo|Email me a sign-in link|contact-box|Want Pro/i);
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }
});
