import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { cachedFood } from '../api/_food-cache.js';

test('production stays within the Vercel Hobby serverless-function limit', () => {
  const apiDir = new URL('../api/', import.meta.url);
  const entrypoints = fs.readdirSync(apiDir)
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'));
  assert.ok(entrypoints.length <= 12, `found ${entrypoints.length} public API functions: ${entrypoints.join(', ')}`);
});

process.env.DEVFIT_JWT_SECRET = 'release-test-only';
process.env.SUPABASE_SERVICE_KEY = 'test-only';
const { default: handler } = await import('../api/data.js');
const { sbSelect, signToken, foodSearchIdentity } = await import('../api/_lib.js');
const { default: offHandler } = await import('../api/off.js');
const { default: proAccessHandler } = await import('../api/pro-access.js');
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
    if (String(url).includes('/rpc/load_devfit_account')) return { ok: false, status: 503 };
    if (String(url).includes('/rpc/save_devfit_data_atomic')) { writes++; return { ok: false, status: 503 }; }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const read = await run({ op: 'get' });
    assert.equal(read.status, 503);
    assert.equal(read.result.rows, undefined);
    const write = await run({ op: 'set', dataType: 'progress', data: { startWeight: 70 } });
    assert.equal(write.status, 503);
    assert.equal(writes, 1, 'the only write attempt is the single atomic RPC');
  } finally { globalThis.fetch = original; }
});
test('forged body email cannot select another account; successful empty reads remain valid', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), body: JSON.parse(options.body || '{}') });
    return { ok: true, json: async () => ({ status: 'ok', rows: [] }) };
  };
  try {
    const r = await run({ op: 'get', email: 'victim@example.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.result.rows, []);
    assert.ok(requests.every(x => !JSON.stringify(x).includes('victim')));
    assert.equal(requests[0].body.p_email, 'owner@example.com');
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

test('Pro authorization ignores claimed token tier and uses the current subscriber record', async () => {
  const original = globalThis.fetch;
  let subscriber = { approved: true, tier: 'free', expiry: '2099-12-31', name: 'QA User' };
  globalThis.fetch = async (url) => {
    if (String(url).includes('devfit_subscribers?')) return { ok: true, json: async () => [subscriber] };
    throw new Error('unexpected request ' + url);
  };
  const runAccess = async (sessionToken) => {
    const res = responseCapture();
    await proAccessHandler({ method: 'POST', headers: { authorization: 'Bearer ' + sessionToken } }, res);
    return res.out;
  };
  try {
    // A browser/token claim of "pro" cannot upgrade a Free database account.
    const claimedPro = signToken({ email: 'food@example.com', tier: 'pro' });
    const free = await runAccess(claimedPro);
    assert.equal(free.status, 403);
    assert.equal(free.body.error, 'pro_required');
    assert.equal(free.body.tier, 'free');
    assert.equal(free.headers['Cache-Control'], 'no-store, no-cache, must-revalidate');

    subscriber = { ...subscriber, tier: 'pro' };
    const pro = await runAccess(claimedPro);
    assert.equal(pro.status, 200);
    assert.equal(pro.body.authorized, true);
    assert.equal(pro.body.tier, 'pro');

    subscriber = { ...subscriber, expiry: '2000-01-01' };
    const expired = await runAccess(claimedPro);
    assert.equal(expired.status, 403);
    assert.equal(expired.body.tier, 'free');

    const forged = await runAccess('not-a-signed-token');
    assert.equal(forged.status, 401);
  } finally { globalThis.fetch = original; }
});

test('client premium actions fail closed and coalesce double taps', async () => {
  const authCode = fs.readFileSync(new URL('../devfit-auth.js', import.meta.url), 'utf8');
  function clientContext(serverResult) {
    const storage = new Map([
      ['devfit_user', JSON.stringify({ email: 'person@gmail.com', approved: true, tier: 'pro' })],
      ['devfit_token', 'signed-session-token'],
      ['devfit_ns_migrated', '1']
    ]);
    let requests = 0;
    const context = {
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key)
      },
      fetch: async (url, options) => {
        requests++;
        assert.equal(url, '/api/pro-access');
        assert.equal(options.headers.Authorization, 'Bearer signed-session-token');
        await Promise.resolve();
        return { ok: serverResult.status === 200, status: serverResult.status, json: async () => serverResult.body };
      },
      crypto: { randomUUID: () => 'qa-device' }, self: { crypto: { randomUUID: () => 'qa-device' } },
      alert() {}, console, setTimeout: () => 0,
      document: { body: null, documentElement: { appendChild() {} }, createElement: () => ({ style: {}, parentNode: null }) },
      location: { href: '', reload() {} }, Date, JSON, Object, Array, Number, String, Math
    };
    context.window = context;
    vm.runInNewContext(authCode, context);
    return { context, storage, requests: () => requests };
  }

  const allowed = clientContext({ status: 200, body: { authorized: true, tier: 'pro', token: 'fresh-token' } });
  const trustedCheck = allowed.context.DevFitAuth.requirePro;
  assert.equal(Reflect.set(allowed.context.DevFitAuth, 'requirePro', async () => true), false);
  assert.equal(Reflect.set(allowed.context, 'DevFitAuth', { requirePro: async () => true }), false);
  assert.equal(allowed.context.DevFitAuth.requirePro, trustedCheck);
  // Replacing window.fetch after the auth script loaded cannot forge the result.
  allowed.context.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'pro_required' }) });
  assert.deepEqual(await Promise.all([allowed.context.DevFitAuth.requirePro(), allowed.context.DevFitAuth.requirePro()]), [true, true]);
  assert.equal(allowed.requests(), 1);
  assert.equal(allowed.storage.get('devfit_token'), 'fresh-token');

  const denied = clientContext({ status: 403, body: { authorized: false, error: 'pro_required', tier: 'free', token: 'free-token' } });
  assert.equal(await denied.context.DevFitAuth.requirePro(), false);
  assert.equal(JSON.parse(denied.storage.get('devfit_user')).tier, 'free');
  assert.equal(denied.context.location.href, 'pricing.html');
});

test('every premium entry point performs action-time server authorization', () => {
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nutrition = fs.readFileSync(new URL('../nutrition.html', import.meta.url), 'utf8');
  const workouts = fs.readFileSync(new URL('../workouts.html', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  assert.match(index, /async function showProgSection\(sec\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(index, /b\.onclick=async[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(nutrition, /async function generateNutritionPDF\(\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(nutrition, /r===30[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(workouts, /async function renderProgressView\(\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(workouts, /async function exportPlanPDF\(\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(workouts, /inp\.value!==todayStr\(\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
  assert.match(settings, /async function generateReport\(range\)[\s\S]*await DevFitAuth\.requirePro\(\)/);
});
