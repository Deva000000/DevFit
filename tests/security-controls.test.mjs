import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.DEVFIT_JWT_SECRET = 'security-controls-test-secret';
process.env.SUPABASE_SERVICE_KEY = 'security-controls-test-service';

const lib = await import('../api/_lib.js?security-controls-tests');

test('device-bound tokens cannot be replayed with a different installation id', () => {
  const first = '0d18b440-b106-4dc1-a168-4fb6a2d63f50';
  const second = '4af6c488-ab98-45db-bf29-a3bdf9f87165';
  const payload = { email: 'owner@example.com', did: lib.sha256Hex(first) };
  assert.equal(lib.tokenDeviceMatches(payload, first), true);
  assert.equal(lib.tokenDeviceMatches(payload, second), false);
  assert.equal(lib.tokenDeviceMatches({ email: payload.email }, second), true, 'legacy tokens remain compatible until verify upgrades them');
});

test('security migration enforces private blocklists, a bounded device policy and owner-only RPCs', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260923093000_add_security_controls.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.devfit_security_events/);
  assert.match(sql, /create table if not exists public\.devfit_security_blocks/);
  assert.match(sql, /v_active_devices >= 3/);
  assert.match(sql, /A fourth active device attempted to use this account/);
  assert.match(sql, /last_seen >= now\(\) - interval '45 days'/);
  assert.match(sql, /for all to anon, authenticated using \(false\) with check \(false\)/);
  assert.match(sql, /revoke all on function public\.check_devfit_security_access[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.check_devfit_security_access[\s\S]*to service_role/);
  assert.match(sql, /delete from public\.devfit_security_events where at < now\(\) - interval '180 days'/);
});

test('all sensitive browser requests carry the stable device id', () => {
  const auth = fs.readFileSync(new URL('../devfit-auth.js', import.meta.url), 'utf8');
  const db = fs.readFileSync(new URL('../devfit-db.js', import.meta.url), 'utf8');
  const food = fs.readFileSync(new URL('../food-search-client.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  assert.match(auth, /body: JSON\.stringify\(\{ deviceId: deviceId\(\) \}\)/);
  assert.match(auth, /provider: provider, token: providerToken, deviceId: deviceId\(\)/);
  assert.match(auth, /token: getToken\(\), email: u\.email, deviceId: deviceId\(\)/);
  assert.match(db, /deviceId: localStorage\.getItem\('devfit_device_id'\)/);
  assert.match(food, /'X-DevFit-Device': deviceId/);
  assert.match(settings, /op:op,deviceId:localStorage\.getItem\('devfit_device_id'\)/);
});

test('admin exposes auditable security events and reversible owner controls', () => {
  const api = fs.readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  for (const action of ['security', 'securityBlock', 'securityUnblock', 'securityResetDevices']) {
    assert.match(api, new RegExp("action === '" + action + "'"));
  }
  assert.match(api, /block_devfit_security_identity/);
  const blockSql = fs.readFileSync(new URL('../supabase/migrations/20260923101500_atomic_security_block.sql', import.meta.url), 'utf8');
  assert.match(blockSql, /set approved = false, tier = 'free'/);
  assert.match(blockSql, /security definer/);
  assert.match(blockSql, /revoke all on function public\.block_devfit_security_identity[\s\S]*from public, anon, authenticated/);
  assert.match(html, /Security & Blocklist/);
  assert.match(html, /3 active devices per account/);
  assert.match(html, /Block only confirmed abuse/);
  assert.match(html, /Unblocking does not automatically reactivate access/);
});

test('pinned third-party chart scripts use subresource integrity', () => {
  for (const name of ['index.html', 'nutrition.html', 'workouts.html', 'settings.html']) {
    const html = fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(html, /chart\.umd\.js" integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
    assert.match(html, /chart\.umd\.min\.js" integrity=\\?"sha384-[A-Za-z0-9+/=]+\\?" crossorigin=\\?"anonymous\\?"/);
  }
});
