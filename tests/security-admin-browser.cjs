const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.route('**/api/admin', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const payload = body.action === 'list' ? { subscribers: [] }
      : body.action === 'getConfig' ? { config: {} }
      : body.action === 'security' ? {
        blocks: [{ id: '11111111-1111-4111-8111-111111111111', scope: 'account', key_hash: 'a'.repeat(64), email: 'blocked@example.com', reason: 'Confirmed sharing', active: true, created_at: '2026-09-23T01:00:00Z' }],
        events: [{ id: 1, email: 'client@example.com', device_hash: 'b'.repeat(64), ip_hash: 'c'.repeat(64), event_type: 'device_limit', severity: 'high', route: '/api/session', reason: 'A fourth active device attempted to use this account', blocked: true, at: '2026-09-23T01:00:00Z' }]
      } : { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.goto('http://127.0.0.1:8765/admin.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#pw').fill('owner-test-password');
  await page.locator('#login-btn').click();
  await page.locator('#tab-security').click();
  await page.locator('#security-events').getByText('device limit').waitFor();

  assert.equal(await page.locator('#view-security').isVisible(), true);
  assert.equal(await page.locator('#security-blocks').getByText('blocked@example.com').isVisible(), true);
  assert.equal(await page.locator('#security-events [data-security-account]').count(), 1);
  assert.equal(await page.locator('#security-events [data-security-device]').count(), 1);
  assert.equal(await page.locator('#security-events [data-security-ip]').count(), 1);
  assert.deepEqual(errors, []);

  await browser.close();
  console.log('security admin browser check passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
