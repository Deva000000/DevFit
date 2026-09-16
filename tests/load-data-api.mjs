// Opt-in staging load test for DevFit's authenticated atomic write path.
// Usage (PowerShell):
//   $env:DEVFIT_LOAD_BASE_URL='https://your-preview.vercel.app'
//   $env:DEVFIT_LOAD_TOKENS='token1,token2,...'
//   node tests/load-data-api.mjs
// Never targets the production hostname. Use synthetic staging accounts only.

import assert from 'node:assert/strict';

const base = String(process.env.DEVFIT_LOAD_BASE_URL || '').replace(/\/$/, '');
const tokens = String(process.env.DEVFIT_LOAD_TOKENS || '').split(',').map((x) => x.trim()).filter(Boolean);
const levels = String(process.env.DEVFIT_LOAD_LEVELS || '100,250,500,1000')
  .split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 1000);

assert.ok(/^https:\/\//.test(base), 'DEVFIT_LOAD_BASE_URL must be an HTTPS staging deployment');
assert.ok(!/devfitportal\.vercel\.app$/i.test(new URL(base).host), 'Refusing to load-test production');
assert.ok(tokens.length, 'DEVFIT_LOAD_TOKENS must contain synthetic staging-account tokens');
assert.ok(levels.length, 'No valid load levels supplied');

function percentile(values, pct) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] || 0;
}

async function api(token, body) {
  const started = performance.now();
  const response = await fetch(base + '/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json, ms: performance.now() - started };
}

for (const concurrency of levels) {
  const results = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    const token = tokens[index % tokens.length];
    const loaded = await api(token, { op: 'get', dataType: 'prefs' });
    if (loaded.status !== 200) return loaded;
    const row = loaded.body.rows && loaded.body.rows[0];
    return api(token, {
      op: 'set', dataType: 'prefs', baseUpdatedAt: row && row.updated_at || '',
      deviceId: 'staging-load-' + (index % tokens.length),
      data: { loadProbe: Date.now() + '-' + index }
    });
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
