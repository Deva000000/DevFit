// Opt-in staging load test for DevFit's authenticated atomic write path.
// Usage (PowerShell):
//   $env:DEVFIT_LOAD_BASE_URL='https://your-preview.vercel.app'
//   $env:DEVFIT_LOAD_TOKENS='token1,token2,...'
//   node tests/load-data-api.mjs
// Never targets the production hostname. Use synthetic staging accounts only.

import assert from 'node:assert/strict';

const base = String(process.env.DEVFIT_LOAD_BASE_URL || '').replace(/\/$/, '');
const tokens = String(process.env.DEVFIT_LOAD_TOKENS || '').split(',').map((x) => x.trim()).filter(Boolean);
const devices = String(process.env.DEVFIT_LOAD_DEVICES || '').split(',').map((x) => x.trim());
const projectRef = String(process.env.DEVFIT_LOAD_PROJECT_REF || '');
const levels = String(process.env.DEVFIT_LOAD_LEVELS || '100,250,500,1000,2000')
  .split(',').map(Number);

assert.ok(/^https:\/\//.test(base), 'DEVFIT_LOAD_BASE_URL must be an HTTPS staging deployment');
assert.ok(!/devfitportal\.vercel\.app$/i.test(new URL(base).host), 'Refusing to load-test production');
assert.ok(tokens.length, 'DEVFIT_LOAD_TOKENS must contain synthetic staging-account tokens');
assert.ok(levels.length && levels.every(n => Number.isInteger(n) && n > 0 && n <= 2000), 'Invalid load levels');
assert.ok(tokens.length >= Math.max(...levels), 'Each virtual user needs its own staging account');
assert.equal(new Set(tokens).size,tokens.length,'Repeated tokens would test same-account conflicts instead of distinct users');
assert.equal(devices.length,tokens.length,'DEVFIT_LOAD_DEVICES must match the staged tokens');
assert.ok(devices.every(d => d.length >= 16 && d.length <= 80),'Invalid staged device IDs');
assert.ok(projectRef && projectRef !== 'zngberygrzpkhiqrrzwj','Expected isolated staging project reference required');
const health = await fetch(base+'/api/health',{signal:AbortSignal.timeout(10000)});
const safety = await health.json();
assert.equal(safety.loadTest?.isolated,true,'Target has not opted into isolated staging load tests');
assert.equal(safety.loadTest.projectRef,projectRef,'Staging deployment points at the wrong database');
for (const token of tokens) {
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.match(claims.email,/^scale-[0-9]+@example\.invalid$/,'Only named synthetic fixtures may be mutated');
}

function percentile(values, pct) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] || 0;
}

async function api(index, body) {
  const started = performance.now();
  const response = await fetch(base + '/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[index] },
    body: JSON.stringify({deviceId:devices[index],...body}), signal:AbortSignal.timeout(25000)
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json, ms: performance.now() - started };
}

for (const concurrency of levels) {
  const results = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    const loaded = await api(index, { op: 'get', dataType: 'prefs' });
    if (loaded.status !== 200) return loaded;
    const row = loaded.body.rows && loaded.body.rows[0];
    const probe = Date.now() + '-' + index;
    const written = await api(index, {
      op: 'set', dataType: 'prefs', baseUpdatedAt: row && row.updated_at || '',
      data: { loadProbe: probe }
    });
    if(written.status !== 200) return written;
    const verified=await api(index,{op:'get',dataType:'prefs'});
    assert.equal(verified.body.rows?.[0]?.data.loadProbe,probe,'Save must read back the exact accepted value');
    return written;
  }));
  const latencies = results.map((x) => x.ms);
  const counts = results.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
  console.log(JSON.stringify({
    concurrency, accounts: tokens.length, statuses: counts,
    p50Ms: Math.round(percentile(latencies, 0.50)),
    p95Ms: Math.round(percentile(latencies, 0.95)),
    p99Ms: Math.round(percentile(latencies, 0.99))
  }));
}
