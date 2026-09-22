import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DEVFIT_JWT_SECRET = 'support-test-secret';
process.env.SUPABASE_SERVICE_KEY = 'support-test-service';
delete process.env.RESEND_API_KEY;
const { default: handler } = await import('../api/data.js?support-tests');

function token(email = 'customer@gmail.com') {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ email })).toString('base64url');
  const s = crypto.createHmac('sha256', process.env.DEVFIT_JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}

function capture() {
  const out = { headers: {} };
  return { out, setHeader(k, v) { out.headers[k] = v; }, status(v) { out.status = v; return this; }, json(v) { out.body = v; } };
}

async function run(body = {}, signed = true) {
  const res = capture();
  await handler({
    method: 'POST', body,
    headers: {
      host: 'devfitportal.vercel.app', origin: 'https://devfitportal.vercel.app',
      ...(signed ? { authorization: 'Bearer ' + token() } : {})
    },
    socket: { remoteAddress: '127.0.0.1' }
  }, res);
  return res.out;
}

test('support requests require a signed DevFit account', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unsigned request reached storage'); };
  try {
    const result = await run({ op: 'submitSupport', whatsapp: '+60183679177', message: 'Please help with login.' }, false);
    assert.equal(result.status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('support request saves the signed Gmail before optional email delivery', async () => {
  const original = globalThis.fetch;
  const writes = [];
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), method = options.method || 'GET';
    if (target.includes('/devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true }] };
    if (target.includes('/rpc/consume_devfit_rate_limit')) return { ok: true, json: async () => ({ allowed: true, retry_after: 0 }) };
    if (target.endsWith('/rest/v1/devfit_support_requests') && method === 'POST') {
      const row = JSON.parse(options.body); writes.push(row);
      return { ok: true, json: async () => [{ ...row, created_at: '2026-09-22T08:00:00Z' }] };
    }
    if (target.includes('/devfit_support_requests?id=eq.') && method === 'PATCH') return { ok: true, json: async () => [{}] };
    throw new Error('unexpected ' + method + ' ' + target);
  };
  try {
    const result = await run({
      op: 'submitSupport', email: 'victim@gmail.com', category: 'app_issue',
      whatsapp: '+60 18-367 9177', message: 'The workout page did not save my last set.'
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.emailPending, true);
    assert.equal(writes[0].email, 'customer@gmail.com');
    assert.equal(writes[0].whatsapp, '+60183679177');
    assert.equal(JSON.stringify(writes).includes('victim@gmail.com'), false);
  } finally { globalThis.fetch = original; }
});

test('support validates WhatsApp and message before inserting a request', async () => {
  const original = globalThis.fetch;
  let inserts = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true }] };
    if (target.includes('/rpc/consume_devfit_rate_limit')) return { ok: true, json: async () => ({ allowed: true, retry_after: 0 }) };
    if ((options.method || 'GET') === 'POST' && target.endsWith('/rest/v1/devfit_support_requests')) inserts++;
    throw new Error('unexpected storage write');
  };
  try {
    const result = await run({ op: 'submitSupport', whatsapp: '123', message: 'short' });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid_whatsapp');
    assert.equal(inserts, 0);
  } finally { globalThis.fetch = original; }
});

test('configured email notification uses the private server key and fixed DevFit recipient', async () => {
  const original = globalThis.fetch;
  const providerCalls = [];
  process.env.RESEND_API_KEY = 're_test_private_key';
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), method = options.method || 'GET';
    if (target.includes('/devfit_subscribers?')) return { ok: true, json: async () => [{ approved: true }] };
    if (target.includes('/rpc/consume_devfit_rate_limit')) return { ok: true, json: async () => ({ allowed: true, retry_after: 0 }) };
    if (target.endsWith('/rest/v1/devfit_support_requests') && method === 'POST') {
      const row = JSON.parse(options.body);
      return { ok: true, json: async () => [{ ...row, created_at: '2026-09-22T08:00:00Z' }] };
    }
    if (target === 'https://api.resend.com/emails') {
      providerCalls.push({ headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ id: 'email_123' }) };
    }
    if (target.includes('/devfit_support_requests?id=eq.') && method === 'PATCH') return { ok: true, json: async () => [{}] };
    throw new Error('unexpected ' + method + ' ' + target);
  };
  try {
    const result = await run({ op: 'submitSupport', category: 'feedback', whatsapp: '+60183679177', message: 'I would like a new progress filter.' });
    assert.equal(result.status, 201);
    assert.equal(result.body.emailDelivered, true);
    assert.equal(providerCalls.length, 1);
    assert.deepEqual(providerCalls[0].body.to, ['devaa1024@gmail.com']);
    assert.equal(providerCalls[0].body.reply_to, 'customer@gmail.com');
    assert.match(providerCalls[0].headers.Authorization, /^Bearer re_test_/);
    assert.match(providerCalls[0].headers['Idempotency-Key'], /^devfit-support\//);
    assert.equal(JSON.stringify(result.body).includes('re_test_private_key'), false);
  } finally {
    delete process.env.RESEND_API_KEY;
    globalThis.fetch = original;
  }
});
