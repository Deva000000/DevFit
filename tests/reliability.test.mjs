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

test('DevFit sessions persist until logout and legacy expiring tokens upgrade safely', async () => {
  process.env.DEVFIT_JWT_SECRET = 'persistent-session-test-secret';
  const { signToken, verifyToken } = await import(new URL('../api/_lib.js?persistent-session-test', import.meta.url));
  const persistent = signToken({ email: 'person@gmail.com', tier: 'free' });
  const persistentPayload = verifyToken(persistent);
  assert.equal(persistentPayload.email, 'person@gmail.com');
  assert.equal(Object.hasOwn(persistentPayload, 'exp'), false);

  // A correctly signed legacy session that crossed its former seven-day expiry
  // remains acceptable once, allowing /api/verify to rotate it transparently.
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const oldPayload = b64({ email: 'person@gmail.com', exp: Math.floor(Date.now() / 1000) - 3600 });
  const signature = crypto.createHmac('sha256', 'persistent-session-test-secret').update(header + '.' + oldPayload).digest().toString('base64url');
  assert.equal(verifyToken(header + '.' + oldPayload + '.' + signature).email, 'person@gmail.com');
});

test('workout merge keeps sessions recorded independently on two devices', () => {
  const code = fs.readFileSync(new URL('../devfit-db.js', import.meta.url), 'utf8');
  const progressModel = fs.readFileSync(new URL('../progress-model.js', import.meta.url), 'utf8');
  const storage = new Map();
  const localStorage = { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const context = { localStorage, fetch: async () => ({ status: 501, ok: false }), console, setTimeout: () => 0, clearTimeout: () => {}, document: { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener: () => {} }, Map, Date, JSON, Object, Array, Number, String, Math };
  context.window = context;
  vm.runInNewContext(progressModel, context);
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

test('a new program cannot be re-anchored onto an older overlapping program', () => {
  const code = fs.readFileSync(new URL('../progress-model.js', import.meta.url), 'utf8');
  const context = { console, Date, JSON, Object, Array, Number, String, Math, Map, crypto: { randomUUID: () => 'new-program-id' } };
  context.window=context;
  vm.runInNewContext(code,context);
  const oldDoc={programStart:'2026-06-29',programDuration:'12',goalType:'gain',bw:Array.from({length:7},()=>Array(7).fill('')),steps:Array.from({length:7},()=>Array(7).fill('')),sleep:Array.from({length:7},()=>Array(7).fill('')),weeklyCheckin:Array.from({length:7},()=>({}))};
  oldDoc.bw[6][0]=70.6;
  const local=context.DevFitProgress.ensureDocument(structuredClone(oldDoc));
  const next=context.DevFitProgress.startProgram(local,{start:'2026-08-13',duration:12,startWeight:'70.7',goal:'75',goalType:'gain'});
  next.bw[0][1]='70.5';
  context.DevFitProgress.captureActive(next);
  const merged=context.DevFitProgress.mergeDocuments(next,oldDoc);
  assert.equal(merged.programStart,'2026-08-10');
  assert.equal(merged.activeProgramId,'new-program-id');
  assert.equal(merged.programs.length,2);
  assert.equal(merged.bw[0][0],'70.7');
  assert.equal(merged.bw[0][1],'70.5');
  assert.equal(merged.programs.some(p=>p.start==='2026-06-29'&&p.bw[6][0]===70.6),true);
});

test('progress UI provisions weeks automatically and uses quick sleep and step selectors', () => {
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/Weeks managed automatically/);
  assert.match(html,/Start new program/);
  assert.doesNotMatch(html,/function addWeek\(|function removeWeek\(|>\+ Add<|>− Remove</);
  assert.match(html,/for\(let n=1000;n<=20000;n\+=1000\)/);
  assert.match(html,/for\(let n=1;n<=12;n\+=0\.5\)/);
});

test('weekly score requires enough weight data and reports coverage', () => {
  const code=fs.readFileSync(new URL('../scoring.js',import.meta.url),'utf8');
  const context={console,Number,Object,Array,Math,appData:{goal:'65',goalType:'loss',targetSteps:'7000',bw:[[70,70.1,'','','','',''],[69.7,69.6,'','','','','']],steps:[[7000],[7000]],sleep:[[7],[7]],weeklyCheckin:[{},{}]},freshCheckin:()=>({})};
  vm.runInNewContext(code,context);
  context.appData.bw[0]=[70,70.2,70.3,70.6,70.7,70.8,70.8];
  const baseline=context.calcTrueScore(0);
  assert.equal(baseline.scores.bw.val,null);
  assert.match(baseline.scores.bw.status,/Baseline set: 70\.6 kg median \(7 logs\)/);
  assert.match(baseline.scores.bw.status,/Week 2 will show progress/);
  const sparse=context.calcTrueScore(1);
  assert.equal(sparse.scores.bw.val,null);
  assert.equal(sparse.signalCount,2);
  assert.equal(sparse.coverage,20);
  assert.equal(sparse.overall,null);
  context.appData.bw=[[70,70.1,69.9,'','','',''],[69.7,69.6,69.5,'','','','']];
  const sufficient=context.calcTrueScore(1);
  assert.notEqual(sufficient.scores.bw.val,null);
  assert.equal(sufficient.signalCount,3);
  assert.equal(sufficient.coverage,37);
  assert.equal(sufficient.overall,null);
  context.appData.weeklyCheckin[1].diet='met';
  const covered=context.calcTrueScore(1);
  assert.equal(covered.coverage,60);
  assert.notEqual(covered.overall,null);

  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/baseline\?'SET':waiting\?'WAIT'/);
  assert.match(html,/Its fixed share in DevFit's overall score/);
  assert.match(html,/There is no single worldwide fitness-score standard/);
  assert.match(html,/The percentages are DevFit's fixed, visible influence model/);
});

test('data API rejects a stale whole-document write with the current row', async () => {
  process.env.DEVFIT_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  const current = { data_type: 'workouts', data: { sessions: [{ date: '2026-08-08' }] }, updated_at: '2026-08-14T01:00:00.000Z' };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/rest/v1/devfit_subscribers?')) return { ok: true, json: async () => [{ email: 'person@gmail.com', approved: true }] };
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

test('persistent session cannot access cloud data after account revocation', async () => {
  process.env.DEVFIT_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  globalThis.fetch = async (url) => {
    if (String(url).includes('/rest/v1/devfit_subscribers?')) return { ok: true, json: async () => [{ email: 'person@gmail.com', approved: false }] };
    throw new Error('Revoked sessions must not reach account data');
  };
  const { default: handler } = await import(new URL('../api/data.js?revocation-test', import.meta.url));
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ email: 'person@gmail.com' });
  const signature = crypto.createHmac('sha256', 'test-secret').update(header + '.' + payload).digest().toString('base64url');
  const req = { method: 'POST', body: { token: header + '.' + payload + '.' + signature, op: 'get' } };
  let status = 0, body;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } };
  await handler(req, res);
  assert.equal(status, 403);
  assert.equal(body.error, 'revoked');
});

test('temporary verification outage keeps the existing client session', async () => {
  const code = fs.readFileSync(new URL('../devfit-auth.js', import.meta.url), 'utf8');
  const storage = new Map([
    ['devfit_user', JSON.stringify({ email: 'person@gmail.com', approved: true, tier: 'free' })],
    ['devfit_token', 'signed-token']
  ]);
  const localStorage = { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const context = {
    localStorage,
    fetch: async () => ({ status: 503, json: async () => ({ error: 'account_store_unavailable' }) }),
    crypto: { randomUUID: () => 'device-test' }, self: { crypto: { randomUUID: () => 'device-test' } },
    console, setTimeout: () => 0,
    document: { body: null, documentElement: { appendChild() {} }, createElement: () => ({ style: {}, parentNode: null }) },
    location: { href: '', reload() {} }, Date, JSON, Object, Array, Number, String, Math
  };
  context.window = context;
  vm.runInNewContext(code, context);
  assert.equal(await context.DevFitAuth.reverify(), 'skip');
  assert.equal(JSON.parse(storage.get('devfit_user')).email, 'person@gmail.com');
  assert.equal(storage.get('devfit_token'), 'signed-token');
});

test('login uses ID credentials and has no redirect-based email or sales panel', () => {
  const html = fs.readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.match(html, /google\.accounts\.id\.initialize/);
  assert.match(html, /finishLogin\('google_id'/);
  assert.doesNotMatch(html, /initTokenClient|emailRedirectTo|signInWithOtp|verifyOtp|Use an email code|Email me a sign-in link|contact-box|Want Pro/i);
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }
});

test('PWA install control supports Android prompt and honest iPhone fallback', () => {
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const worker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(index, /beforeinstallprompt/);
  assert.match(index, />Install App<\/button>/);
  assert.match(index, /navigator\.clipboard\.writeText\('https:\/\/devfitportal\.vercel\.app'\)/);
  assert.match(index, /Share<\/strong> → <strong>Add to Home Screen/);
  assert.doesNotMatch(index, /localStorage\.setItem\('pwa-install-dismissed'/);
  assert.match(settings, /<div class="title">Install DevFit App<\/div>/);
  assert.match(settings, /if\(!deferredInstallPrompt\)\{\s*showIosHint\(\)/);
  assert.equal(manifest.display, 'standalone');
  assert.match(worker, /devfit-v4\.82\.0/);
  assert.doesNotMatch(worker, /\.then\(\(\) => self\.skipWaiting\(\)\)/);

  for (const html of [index, settings]) {
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new Function(match[1]);
    }
  }
});

test('backup restore is account-bound, merge-only and monitored', () => {
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  const errors = fs.readFileSync(new URL('../devfit-errorlog.js', import.meta.url), 'utf8');
  assert.match(settings, /Save \/ Share Backup File/);
  assert.match(settings, /navigator\.canShare\(\{files:\[file\]\}\)/);
  assert.match(settings, /from!==owner/);
  assert.match(settings, /DevFitDB\._merge\(type,current,incoming\)/);
  assert.match(settings, /devfit_pre_import_backup::/);
  assert.doesNotMatch(settings, /Import anyway\? It replaces/);
  assert.match(errors, /window\.DevFitErrors/);
});

test('pricing is accurate and report periods never use future planned weeks', () => {
  const pricing = fs.readFileSync(new URL('../pricing.html', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  assert.match(pricing, /Trained by DevFit\?/);
  assert.match(pricing, /Seven-signal score with data coverage/);
  assert.match(pricing, /Pro unlocks analysis — it never holds your data hostage/);
  assert.doesNotMatch(pricing, /Coached by Deva|six-signal|deload prompts|goal projection/i);
  assert.match(settings, /function reportableEndWeek\(\)/);
  assert.match(settings, /Program to date — Weeks 1–/);
  assert.match(settings, /\[4,8\]\.forEach\(nWk/);
  assert.match(settings, /label:'Recent '\+nWk\+' weeks — Weeks '/);
  assert.match(settings, /future weeks stay hidden/i);
  assert.doesNotMatch(settings, /label:'All weeks \(1–'\+totalWeeks|const s=totalWeeks-nWk/);
});

test('public pages contain legal links and no retired sync or trainer claims', () => {
  const names = ['landing.html','pricing.html','login.html','index.html','settings.html'];
  const publicHtml = names.map((n) => fs.readFileSync(new URL('../'+n, import.meta.url), 'utf8')).join('\n');
  assert.match(publicHtml, /privacy\.html/);
  assert.match(publicHtml, /terms\.html/);
  assert.doesNotMatch(publicHtml, /contact (your )?trainer|trainer \/ client sync|automatic cloud backup|multi-device sync|syncs automatically/i);
  const privacy = fs.readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  const terms = fs.readFileSync(new URL('../terms.html', import.meta.url), 'utf8');
  assert.match(privacy, /Retention and deletion/);
  assert.match(terms, /Payments and refunds/);
});

test('login has no obsolete browser Supabase or magic-link handler', () => {
  const html = fs.readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /supabase\.min\.js|handleLegacyLink|SB_KEY|SB_URL/);
  assert.doesNotMatch(html, /devfit_theme.*light|src="theme\.js"/);
  assert.match(html, /removeAttribute\('data-theme'\)/);
});

test('legal pages return to the same-origin previous screen', () => {
  for (const name of ['privacy.html','terms.html']) {
    const html = fs.readFileSync(new URL('../'+name, import.meta.url), 'utf8');
    assert.match(html, /document\.referrer/);
    assert.match(html, /new URL\(document\.referrer\)\.origin===location\.origin/);
    assert.match(html, /history\.back\(\)/);
  }
});

test('settings install guide is device-focused and exposes real platform actions', () => {
  const html = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  assert.match(html, /id="ig-android-install"/);
  assert.match(html, /id="ig-copy-link"/);
  assert.match(html, /android\.style\.display=onIOS\?'none':'block'/);
  assert.match(html, /ios\.style\.display=onAndroid\?'none':'block'/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /navigator\.clipboard\.writeText\(url\)/);
});

test('verification records only the signed token email', () => {
  const source = fs.readFileSync(new URL('../api/verify.js', import.meta.url), 'utf8');
  const verifiedAt = source.indexOf('const payload = verifyToken(body.token)');
  const recordedAt = source.indexOf('recordLogin(payload.email');
  assert.ok(verifiedAt >= 0 && recordedAt > verifiedAt);
  assert.doesNotMatch(source, /recordLogin\(body\.email/);
});

test('paid reports use the adaptive premium renderer and never plot missing values as zero', () => {
  const settings = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  const reportPdf = fs.readFileSync(new URL('../report-pdf.js', import.meta.url), 'utf8');
  const reportEngine = fs.readFileSync(new URL('../report-engine.js', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

  new Function(reportPdf);
  assert.match(settings, /<script src="report-pdf\.js"><\/script>/);
  assert.match(settings, /DevFitPremiumPDF\.paint\(A,N\)/);
  assert.match(worker, /'\.\/report-pdf\.js'/);
  assert.match(reportPdf, /if\(A\.weight\.daysLogged>=2\)/);
  assert.match(reportPdf, /if\(A\.training\.sessions>0\)/);
  assert.match(reportPdf, /if\(A\.nutrition\.daysLogged>0\)/);
  assert.match(reportPdf, /if\(A\.score\.weeksScored>=2\)/);
  assert.match(reportPdf, /A\.meta\.single/);
  assert.match(settings, /A\.history=DevFitReport\.analyze\(0,range\.endW/);
  assert.match(settings, /A\.meta\.single&&A\.history&&A\.history\.rows/);
  assert.match(reportPdf, /function weeklyArchive\(\)/);
  assert.match(reportPdf, /function scoreBreakdown\(row\)/);
  assert.match(reportPdf, /function detailedSessions\(sessions\)/);
  assert.match(reportPdf, /function compactSignals\(row\)/);
  assert.match(reportPdf, /Every exercise, completed set and progress remark/);
  assert.match(reportPdf, /const p=ex\.progress\|\|null/);
  assert.match(reportPdf, /result\+=' '\+\(pct>0\?'\+':''\)\+pct\+'%'/);
  assert.match(reportPdf, /WHAT MOVED FORWARD/);
  assert.match(reportPdf, /WHAT NEEDS ATTENTION/);
  assert.match(reportPdf, /Daily macros measured against saved targets/);
  assert.match(reportPdf, /Exactly where the saved targets were missed/);
  assert.match(reportEngine, /exerciseProgress/);
  assert.match(reportEngine, /progressByOccurrence/);
  assert.match(reportEngine, /progress:progressByOccurrence/);
  assert.match(reportEngine, /progressCounts/);
  assert.match(reportEngine, /A\.nutrition\.adherence/);
  assert.doesNotMatch(settings, /r=>r\.score==null\?0:r\.score/);
  assert.doesNotMatch(settings, /p=>p\.cal==null\?0:p\.cal/);
  assert.doesNotMatch(settings, /r=>r\.stepsAvg==null\?0/);
});

test('all edited HTML inline scripts parse', () => {
  for (const name of ['admin.html','landing.html','pricing.html','login.html','index.html','nutrition.html','workouts.html','settings.html','privacy.html','terms.html']) {
    const html = fs.readFileSync(new URL('../'+name, import.meta.url), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new Function(match[1]);
    }
  }
});
