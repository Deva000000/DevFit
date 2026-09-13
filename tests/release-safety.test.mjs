import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DEVFIT_JWT_SECRET = 'release-test-only';
process.env.SUPABASE_SERVICE_KEY = 'test-only';
const { default: handler } = await import('../api/data.js');
const { sbSelect, signToken, foodSearchIdentity } = await import('../api/_lib.js');
const { default: offHandler } = await import('../api/off.js');
function token(email) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return h + '.' + p + '.' + crypto.createHmac('sha256', process.env.DEVFIT_JWT_SECRET).update(h + '.' + p).digest('base64url');
}
async function run(body) {
  let status, result;
  await handler({ method: 'POST', headers: {}, body: { token: token('owner@example.com'), ...body } }, {
    setHeader() {}, status(s) { status = s; return this; }, json(r) { result = r; }
  });
  return { status, result };
}
test('failed reads never masquerade as a new account or initiate an insert', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true }] };
    if (String(url).includes('consume_devfit_rate_limit')) return { ok: true, json: async () => ({ allowed: true }) };
    if (String(url).includes('/devfit_data?')) return { ok: false, status: 503 };
    if (String(url).endsWith('/devfit_data') && options.method === 'POST') writes++;
    return { ok: true, json: async () => ({}) };
  };
  try {
    const read = await run({ op: 'get' });
    assert.equal(read.status, 503);
    assert.equal(read.result.rows, undefined);
    const write = await run({ op: 'set', dataType: 'progress', data: { startWeight: 70 } });
    assert.equal(write.status, 500);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = original; }
});
test('forged body email cannot select another account; successful empty reads remain valid', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => String(url).includes('devfit_subscribers?') ? [{ approved: true }] : [] };
  };
  try {
    const r = await run({ op: 'get', email: 'victim@example.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.result.rows, []);
    assert.ok(urls.every(u => !u.includes('victim')));
    assert.ok(urls.some(u => u.includes('email=eq.owner%40example.com')));
  } finally { globalThis.fetch = original; }
});
test('database transport and malformed JSON failures use the unavailable result', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('network offline'); };
    assert.equal(await sbSelect('devfit_data', ''), null);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } });
    assert.equal(await sbSelect('devfit_data', ''), null);
  } finally { globalThis.fetch = original; }
});

function responseCapture() {
  const out = { headers: {} };
  return {
    out,
    setHeader(key, value) { out.headers[key] = value; },
    status(value) { out.status = value; return this; },
    json(value) { out.body = value; }
  };
}

test('food search requires a signed session and fails closed if durable limits are unavailable', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error('must not be called'); };
    const denied = await foodSearchIdentity({ headers: {} });
    assert.deepEqual(denied, { ok: false, status: 401, error: 'sign_in_required' });
    assert.equal(calls, 0);

    const valid = signToken({ email: 'food@example.com' });
    const req = { headers: { authorization: 'Bearer ' + valid, 'x-forwarded-for': '203.0.113.6' } };
    globalThis.fetch = async () => { throw new Error('database unavailable'); };
    assert.deepEqual(await foodSearchIdentity(req), { ok: false, status: 503, error: 'food_search_unavailable' });
  } finally { globalThis.fetch = original; }
});

test('food proxy never calls an upstream source for unsigned or rate-limited traffic', async () => {
  const original = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    const noToken = responseCapture();
    await offHandler({ method: 'GET', headers: {}, query: { query: 'chicken' } }, noToken);
    assert.equal(noToken.out.status, 401);

    const valid = signToken({ email: 'food@example.com' });
    globalThis.fetch = async (url) => {
      if (String(url).includes('consume_devfit_rate_limit')) return { ok: true, json: async () => [{ allowed: false, retry_after: 60 }] };
      upstreamCalls++; return { ok: true, json: async () => ({ hits: [] }) };
    };
    const limited = responseCapture();
    await offHandler({ method: 'GET', headers: { authorization: 'Bearer ' + valid, 'x-forwarded-for': '203.0.113.6' }, query: { query: 'chicken' } }, limited);
    assert.equal(limited.out.status, 429);
    assert.equal(limited.out.headers['Retry-After'], '60');
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = original; }
});
