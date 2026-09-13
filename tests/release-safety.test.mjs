import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { cachedFood } from '../api/_food-cache.js';

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
      if (String(url).includes('devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true }] };
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

test('food access is equal for free and pro and blocks deleted or revoked accounts', async () => {
  const original = globalThis.fetch;
  const req = { headers: { authorization: 'Bearer ' + signToken({ email: 'food@example.com', tier: 'pro' }) } };
  let sub = { approved: true, tier: 'free' }, quotaCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('devfit_subscribers?')) return { ok: true, json: async () => sub ? [sub] : [] };
    quotaCalls++;
    return { ok: true, json: async () => [{ allowed: true }] };
  };
  try {
    assert.equal((await foodSearchIdentity(req)).ok, true);
    sub.tier = 'pro';
    assert.equal((await foodSearchIdentity(req)).ok, true);
    sub.approved = false;
    assert.equal((await foodSearchIdentity(req)).status, 403);
    sub = null;
    assert.equal((await foodSearchIdentity(req)).status, 403);
    assert.equal(quotaCalls, 4);
  } finally { globalThis.fetch = original; }
});

test('cached food results still require authorization and responses prohibit shared caching', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true, tier: 'free' }] };
    if (String(url).includes('consume_devfit_rate_limit')) return { ok: true, json: async () => [{ allowed: true }] };
    calls++;
    return { ok: true, json: async () => ({ hits: [{ product_name: 'QA food', nutriments: { 'energy-kcal_100g': 100 } }] }) };
  };
  try {
    const req = { method: 'GET', query: { query: 'cache-auth-test' }, headers: { authorization: 'Bearer ' + signToken({ email: 'food@example.com' }) } };
    for (let i = 0; i < 2; i++) {
      const res = responseCapture(); await offHandler(req, res);
      assert.equal(res.out.status, 200); assert.equal(res.out.body.products.length, 1);
      assert.equal(res.out.headers['Cache-Control'], 'private, no-store');
    }
    assert.equal(calls, 1);
    const res = responseCapture(); await offHandler({ ...req, headers: {} }, res);
    assert.equal(res.out.status, 401); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('server food cache coalesces requests, serves known results on outage, and expires them', async () => {
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  try {
    const fetcher = async () => { calls++; return [{ name: 'QA food' }]; };
    const [a, b] = await Promise.all([cachedFood('qa-coalesce', fetcher), cachedFood('qa-coalesce', fetcher)]);
    assert.deepEqual(a, b); assert.equal(calls, 1);
    now += 16 * 60 * 1000;
    const fail = async () => { throw new Error('upstream down'); };
    assert.deepEqual(await cachedFood('qa-coalesce', fail), a);
    now += 24 * 60 * 60 * 1000;
    await assert.rejects(cachedFood('qa-coalesce', fail), /upstream down/);
  } finally { Date.now = originalNow; }
});

test('client food cache shares in-flight work and never stores errors or sends a token to an external URL', async () => {
  let requests = 0, fail = false;
  const context = { window: {}, Map, Date, Response, AbortSignal, fetch: async () => {
    requests++; return new Response(JSON.stringify(fail ? { error: 'provider down', foods: [] } : { foods: [{ name: 'QA food' }] }));
  } };
  context.window.DevFitAuth = { getToken: () => 'qa-token' };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../food-search-client.js', import.meta.url), 'utf8'), context);
  const search = context.window.DevFitFoodSearch.search;
  const [a, b] = await Promise.all([search('/api/usda?query=qa'), search('/api/usda?query=qa')]);
  assert.deepEqual(await a.json(), await b.json()); assert.equal(requests, 1);
  await search('/api/usda?query=qa'); assert.equal(requests, 1);
  fail = true;
  await search('/api/usda?query=fail'); await search('/api/usda?query=fail'); assert.equal(requests, 3);
  await assert.rejects(search('https://other.test/api/usda?query=qa'), /invalid food endpoint/);
  assert.equal(requests, 3);
});
