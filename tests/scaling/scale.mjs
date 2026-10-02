// Real production handlers + real PostgreSQL functions, with a local HTTP
// adapter replacing only Supabase's managed PostgREST transport. No cloud keys,
// customer data, Google requests, emails or food-provider calls are used.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { once } from 'node:events';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import pg from 'pg';

const root = new URL('../../', import.meta.url);
const connectionString = process.env.DEVFIT_SCALE_DATABASE_URL;
assert.ok(connectionString, 'Set DEVFIT_SCALE_DATABASE_URL to a disposable local database');
const dbUrl = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname), 'Cloud databases are forbidden');
assert.match(dbUrl.pathname, /^\/devfit_scale[a-z0-9_]*$/, 'Database name must start with devfit_scale');
const count = Number(process.env.DEVFIT_SCALE_USERS || 2000);
assert.ok(Number.isInteger(count) && count >= 100 && count <= 5000);
const levels = (process.env.DEVFIT_SCALE_LEVELS || '100,250,500,1000,2000').split(',').map(Number);
assert.ok(levels.every(n => Number.isInteger(n) && n > 0 && n <= count));
const baseline = process.env.DEVFIT_SCALE_BASELINE === '1';
const soakSeconds = Number(process.env.DEVFIT_SCALE_SOAK_SECONDS || 120);
assert.ok(Number.isInteger(soakSeconds) && soakSeconds >= 0 && soakSeconds <= 3600);
const gateUsers = Number(process.env.DEVFIT_SCALE_GATE_USERS || count);
assert.ok(Number.isInteger(gateUsers) && gateUsers > 0 && gateUsers <= count);
const poolSize = Number(process.env.DEVFIT_SCALE_POOL_SIZE || 10);
assert.ok(Number.isInteger(poolSize) && poolSize >= 1 && poolSize <= 40);
const pool = new pg.Pool({ connectionString, max: poolSize, connectionTimeoutMillis: 15000,
  query_timeout: 20000, options: '-c role=service_role -c statement_timeout=15000' });
const owner = new pg.Pool({ connectionString, max: 2 });
assert.equal((await owner.query('select count(*)::int n from public.devfit_scale_environment')).rows[0].n, 1);
const label = process.env.DEVFIT_SCALE_LABEL || (baseline ? 'baseline' : 'fixed');
assert.match(label,/^[a-z0-9-]{1,50}$/);
const report = { label, at: new Date().toISOString(), topology: `local HTTP handlers → local PostgREST adapter → PostgreSQL 17, pool=${poolSize}`,
  cloudCapacityVerified: false, complete:false, users: count, scenarios: [], checks: [], errors: [], poolMaxWaiting: 0,
  latencyTargetMs:{p95:2000,p99:5000},
  host:{cpus:os.cpus().length,cpu:os.cpus()[0]?.model,memoryBytes:os.totalmem()},rpcLatency:{},transportErrors:{} };
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
let failGateway = false, loseNextSaveResponse = false;
let apiServer, gateway;
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(JSON.stringify({ check: name, ...details })); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (a, p) => a.slice().sort((x,y) => x-y)[Math.min(a.length-1, Math.ceil(a.length*p)-1)] || 0;
const metric = ({ value, ...sample }) => sample;
const statuses = samples => samples.reduce((counts, s) => { counts[s.status] = (counts[s.status] || 0)+1; return counts; }, {});
async function body(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 4*1024*1024) throw Error('body_too_large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
}
const rpcArgs = {
  load_devfit_account_delta: ['p_email','p_data_type','p_versions','p_security_context'],
  patch_devfit_data_atomic: ['p_email','p_data_type','p_changes','p_base_updated_at','p_device_id','p_ip_hash','p_security_context'],
  load_devfit_account: ['p_email','p_data_type','p_security_context'],
  save_devfit_data_atomic: ['p_email','p_data_type','p_data','p_base_updated_at','p_device_id','p_ip_hash','p_security_context'],
  check_devfit_security_access: ['p_email','p_device_id','p_ip_hash','p_user_agent','p_route','p_register','p_is_login','p_require_known'],
  consume_devfit_rate_limit: ['p_id','p_limit','p_window_seconds'],
  record_devfit_error: ['p_type','p_message','p_stack','p_src','p_page','p_ua','p_status']
};
const makeDoc = (type, revision = 0) => {
  if (type === 'nutrition') {
    const days = {};
    for (let d=0; d<84; d++) {
      const date = new Date(Date.UTC(2026, 6, 1+d)).toISOString().slice(0,10);
      days[date] = { target: { kcal:2400, p:150, c:270, f:80 }, meals: ['Breakfast','Lunch','Dinner'].map((name,mi) => ({
        id: `meal-${d}-${mi}`, name, foods: Array.from({length:3}, (_,fi) => ({ id:`food-${d}-${mi}-${fi}`,name:`Food ${fi}`,grams:100,kcal:180,p:15,c:25,f:5 })) })) };
    }
    days['2026-09-22'].meals[0].foods[0].grams = 100+revision;
    return { days, scaleRevision:revision };
  }
  if (type === 'workouts') return { sessions: Array.from({length:52},(_,s) => ({ id:`session-${s}`,
    date:new Date(Date.UTC(2026, 5, 1+s*2)).toISOString().slice(0,10),workoutId:'upper',
    logs: Array.from({length:6},(_,e) => ({exId:`e-${e}`,name:`Exercise ${e}`,sets:Array.from({length:3},(_,j) => ({weight:60+(s===51 && e===0 && j===0?revision:0),reps:10+j}))})) })),scaleRevision:revision };
  return { programs:[{ id:'program-1',programStart:'2026-07-06',bw:Array.from({length:12},(_,w) => [70+w/10+(w===11?revision/100:0),70.1,70.2,70.3,70.4,70.5,70.6]),
    steps:Array.from({length:12},()=>[8000,8100,8200,8000,9000,7000,8500]),sleep:Array.from({length:12},()=>[7,8,7,8,7,8,7]),
    weeklyCheckin:Array.from({length:12},()=>({stress:2})) }],scaleRevision:revision };
};
const docs = ['progress','nutrition','workouts'].map(type => ({type,data:makeDoc(type)}));
report.documentBytes = Object.fromEntries(docs.map(d=>[d.type,Buffer.byteLength(JSON.stringify(d.data))]));

try {
  // The environment marker and localhost assertion are mandatory. Reset only
  // synthetic fixture tables inside this disposable database for repeatability.
  if(process.env.DEVFIT_SCALE_SKIP_SEED !== '1'){
  await owner.query('truncate devfit_data,devfit_data_versions,devfit_records,devfit_rate,devfit_logins,devfit_subscribers,devfit_security_blocks,devfit_security_events,devfit_errors');
  for (let start=0; start<count; start+=100) {
    const n = Math.min(100,count-start);
    const subscribers = Array.from({length:n},(_,j)=>({email:`scale-${start+j}@example.invalid`,name:'Synthetic user',tier:(start+j)%2?'pro':'free',approved:true}));
    await owner.query('insert into devfit_subscribers(email,name,tier,approved) select email,name,tier,approved from jsonb_to_recordset($1::jsonb) as x(email text,name text,tier text,approved boolean)',[JSON.stringify(subscribers)]);
    await owner.query("insert into devfit_logins(email,device_id,user_agent) select email,'scale-device-'||split_part(split_part(email,'@',1),'-',2)||'-installation', 'DevFit scale test' from devfit_subscribers where email=any($1::text[])",[subscribers.map(s=>s.email)]);
    const rows = subscribers.flatMap(s => docs.map(d => ({email:s.email,data_type:d.type,data:d.data})));
    await owner.query('insert into devfit_data(email,data_type,data) select email,data_type,data from jsonb_to_recordset($1::jsonb) as x(email text,data_type text,data jsonb)',[JSON.stringify(rows)]);
  }
  // Pre-populate the shadow store as normal existing-account saves would.
  for (let start=0; start<count; start+=100) {
    await owner.query("select sync_devfit_records(email,data_type,data) from devfit_data where email=any($1::text[])",[Array.from({length:Math.min(100,count-start)},(_,j)=>`scale-${start+j}@example.invalid`)]);
  }
  await owner.query('analyze');
  }else{
    assert.equal((await owner.query("select count(*)::int n from devfit_subscribers where email ~ '^scale-[0-9]+@example[.]invalid$'")).rows[0].n,count,'Existing fixture set must match requested users');
  }
  check('synthetic fixtures seeded', { accounts:count, ...report.documentBytes });

  gateway = http.createServer(async (req,res) => {
    try {
      if (failGateway) return json(res,503,{error:'synthetic_dependency_outage'});
      assert.equal(req.headers.apikey,'local-scale-service');
      const url = new URL(req.url,'http://127.0.0.1');
      const fn = url.pathname.split('/').at(-1);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const args = await body(req);
        const names = rpcArgs[fn]?.filter(n=>Object.hasOwn(args,n)); assert.ok(names,'unexpected RPC '+fn);
        const vals = names.map(n=>['p_data','p_security_context','p_versions','p_changes'].includes(n)?JSON.stringify(args[n]):args[n] ?? null);
        const placeholders = names.map((n,i)=>`${n} => $${i+1}${['p_data','p_security_context','p_versions','p_changes'].includes(n)?'::jsonb':''}`).join(',');
        report.poolMaxWaiting = Math.max(report.poolMaxWaiting,pool.waitingCount);
        const qt=performance.now();
        const r = await pool.query(fn==='consume_devfit_rate_limit'
          ? `select * from public.${fn}(${placeholders})`
          : `select public.${fn}(${placeholders}) result`, vals);
        (report.rpcLatency[fn] ||= []).push(performance.now()-qt);
        if (fn==='save_devfit_data_atomic' && loseNextSaveResponse) {
          loseNextSaveResponse=false; return json(res,503,{error:'response_lost_after_commit'});
        }
        return json(res,200,fn==='consume_devfit_rate_limit'?r.rows:r.rows[0].result);
      }
      if (url.pathname==='/rest/v1/devfit_subscribers') {
        const email = url.searchParams.get('email'); assert.ok(email?.startsWith('eq.'));
        return json(res,200,(await pool.query('select * from devfit_subscribers where email=$1',[email.slice(3)])).rows);
      }
      if (url.pathname==='/rest/v1/devfit_errors' && req.method==='POST') return json(res,201,{});
      return json(res,404,{error:'unsupported_adapter_route'});
    } catch(e) { report.errors.push({layer:'gateway',code:e.code||e.message}); json(res,503,{error:'adapter_failure'}); }
  });
  gateway.listen({port:0,host:'127.0.0.1',backlog:4096}); await once(gateway,'listening');
  process.env.SUPABASE_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.SUPABASE_SERVICE_KEY = 'local-scale-service';
  process.env.DEVFIT_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  const { signToken,sha256Hex } = await import(new URL('api/_lib.js',root));
  const handlers = Object.fromEntries(await Promise.all(['data','verify','pro-access'].map(async n => [n,(await import(new URL(`api/${n}.js`,root))).default])));
  const users = Array.from({length:count},(_,i)=>{
    const deviceId=`scale-device-${i}-installation`,email=`scale-${i}@example.invalid`;
    return { email,deviceId,token:signToken({email,did:sha256Hex(deviceId),tier:'pro'}) };
  });
  apiServer = http.createServer(async (req,res) => {
    try {
      const handler = handlers[req.url?.split('/').at(-1)];
      if (!handler) return json(res,404,{error:'route'});
      req.body = await body(req);
      res.status = function(status){ this.statusCode=status; return this; };
      res.json = function(value){ this.end(JSON.stringify(value)); return this; };
      await handler(req,res);
    } catch(e) { report.errors.push({layer:'api',code:e.code||e.message}); if(!res.headersSent)json(res,500,{error:'harness_failure'}); else res.end(); }
  });
  apiServer.listen({port:0,host:'127.0.0.1',backlog:4096}); await once(apiServer,'listening');
  const base = `http://127.0.0.1:${apiServer.address().port}`;
  const call = async (user,route,bodyValue,expected=200) => {
    const t = performance.now();
    try {
      const r = await fetch(`${base}/api/${route}`, {method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+user.token,
        'X-Forwarded-For':'198.51.100.42','User-Agent':'DevFit scale test'},body:JSON.stringify({deviceId:user.deviceId,...bodyValue}),signal:AbortSignal.timeout(25000)});
      const value=await r.json();
      return {status:r.status,expected,value,ms:performance.now()-t};
    } catch(e){const code=e.cause?.code||e.code||e.name;report.transportErrors[code]=(report.transportErrors[code]||0)+1;
      return{status:0,expected,value:{error:code},ms:performance.now()-t};}
  };
  const load = (u,type) => call(u,'data',{op:'get',dataType:type});
  const save = (u,type,data,version) => call(u,'data',{op:'set',dataType:type,data,baseUpdatedAt:version});
  let revision=0;
  for (const concurrency of levels) {
    revision++;
    const started=performance.now();
    const results = await Promise.all(users.slice(0,concurrency).map(async (u,i)=>{
      const type=docs[i%3].type;
      const read=await load(u,type); if(read.status!==200)return[{...metric(read),action:'read'}];
      const row=read.value.rows[0]; assert.ok(row,'missing seeded row');
      const data=makeDoc(type,revision);
      const write=await save(u,type,data,row.updated_at);
      const verify=await load(u,type);
      const correct=write.status!==200 ? null : verify.status===200 && verify.value.rows[0].data.scaleRevision===revision;
      return [{...metric(read),action:'read'},{...metric(write),action:'write'},{...metric(verify),action:'read-back',correct}];
    }));
    const flat=results.flat(),elapsed=(performance.now()-started)/1000;
    const scenario={name:'simultaneous mixed read/write/read-back',concurrency,sharedIP:true,seconds:+elapsed.toFixed(2),rps:+(flat.length/elapsed).toFixed(1),
      actions:Object.fromEntries(['read','write','read-back'].map(action=>{
        const a=flat.filter(r=>r.action===action);return[action,{count:a.length,statuses:statuses(a),failed:a.filter(r=>r.status!==r.expected).length,p50Ms:Math.round(percentile(a.map(r=>r.ms),.5)),p95Ms:Math.round(percentile(a.map(r=>r.ms),.95)),p99Ms:Math.round(percentile(a.map(r=>r.ms),.99))}];
      })),incorrectReadBack:flat.filter(r=>r.correct===false).length};
    report.scenarios.push(scenario); console.log(JSON.stringify(scenario));
  }

  if (!baseline) {
    const patchResults=await Promise.all(users.slice(0,100).map(async u=>{
      const read=await load(u,'nutrition');assert.equal(read.status,200);
      const row=read.value.rows[0],expected=Number(row.data.days['2026-09-22'].meals[0].foods[0].grams)+1;
      const change={op:'set',path:['days','2026-09-22','meals','0','foods','0','grams'],value:expected};
      const payload={op:'patch',dataType:'nutrition',baseUpdatedAt:row.updated_at,changes:[change]};
      const write=await call(u,'data',payload);assert.equal(write.status,200);
      const verify=await load(u,'nutrition');assert.equal(verify.status,200);
      assert.equal(verify.value.rows[0].data.days['2026-09-22'].meals[0].foods[0].grams,expected);
      const conditional=await call(u,'data',{op:'get',dataType:'nutrition',knownVersions:{nutrition:write.value.updated_at}});
      assert.equal(conditional.status,200);assert.equal(conditional.value.rows[0].notModified,true);
      assert.equal(conditional.value.rows[0].data,undefined);
      return{writeMs:write.ms,conditionalMs:conditional.ms,fullBytes:Buffer.byteLength(JSON.stringify(row.data)),patchBytes:Buffer.byteLength(JSON.stringify(payload))};
    }));
    check('100 simultaneous incremental saves and conditional reads preserve exact values',{
      patchP95Ms:Math.round(percentile(patchResults.map(r=>r.writeMs),.95)),
      conditionalP95Ms:Math.round(percentile(patchResults.map(r=>r.conditionalMs),.95)),
      exampleFullBytes:patchResults[0].fullBytes,examplePatchBytes:patchResults[0].patchBytes});
  }
  // Race on a missing row, stale update, duplicate retry after response loss.
  const u=users[0];
  await owner.query("delete from devfit_data where email=$1 and data_type='prefs'",[u.email]);
  const first=await Promise.all([save(u,'prefs',{probe:'a'},''),save(u,'prefs',{probe:'b'},'')]);
  assert.deepEqual(first.map(r=>r.status).sort(),[200,409]);
  check('concurrent first writes: one accepted, one conflict');
  const prefs=(await load(u,'prefs')).value.rows[0];
  const race=await Promise.all([save(u,'prefs',{probe:'c'},prefs.updated_at),save(u,'prefs',{probe:'d'},prefs.updated_at)]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  check('same-account stale writes cannot silently overwrite');
  const p2=(await load(u,'prefs')).value.rows[0];
  loseNextSaveResponse=true;
  const lost=await save(u,'prefs',{probe:'committed'},p2.updated_at); assert.equal(lost.status,503);
  const retry=await save(u,'prefs',{probe:'committed'},p2.updated_at);
  assert.equal(retry.status,200);assert.equal(retry.value.unchanged,true);
  check('lost response after commit: retry idempotent');
  failGateway=true;
  assert.equal((await load(u,'prefs')).status,503);
  failGateway=false;
  assert.equal((await load(u,'prefs')).value.rows[0].data.probe,'committed');
  check('dependency outage rejects reads, recovery preserves committed data');

  const gates=await Promise.all(users.slice(0,gateUsers).map((u,i)=>call(u,'pro-access',{},i%2?200:403)));
  const gateFailures=gates.filter(r=>r.status!==r.expected).length;
  const gateScenario={name:'simultaneous current Free/Pro authorization',concurrency:gateUsers,
    failed:gateFailures,statuses:statuses(gates),p95Ms:Math.round(percentile(gates.map(r=>r.ms),.95))};
  report.scenarios.push(gateScenario);console.log(JSON.stringify(gateScenario));
  check('Free/Pro decision checks completed', {accounts:gateUsers,failed:gateFailures});
  await owner.query('update devfit_subscribers set approved=false where email=$1',[u.email]);
  assert.equal((await load(u,'prefs')).status,403);
  await owner.query('update devfit_subscribers set approved=true where email=$1',[u.email]);
  check('revocation takes effect with existing signed token');
  const tampered={...u,token:u.token.slice(0,-8)+'aaaaaaaa'};
  assert.equal((await load(tampered,'prefs')).status,401);
  check('forged signed session denied');
  const other=await call(users[1],'data',{op:'get',dataType:'prefs',email:u.email});
  assert.equal(other.status,200);assert.equal(other.value.rows.length,0);
  check('body email cannot read another account');
  await owner.query("update devfit_logins set last_seen=now()-interval '46 days' where email=$1 and device_id=$2",[u.email,u.deviceId]);
  assert.equal((await load(u,'prefs')).status,200);
  assert.ok((await owner.query("select last_seen>now()-interval '1 minute' fresh from devfit_logins where email=$1 and device_id=$2",[u.email,u.deviceId])).rows[0].fresh);
  check('continued authenticated use refreshes an old device heartbeat');

  if(!baseline){
    const requestIpHash=sha256Hex('198.51.100.42');
    const ipBucket='data_ip:'+requestIpHash+':'+(crypto.createHash('sha256').update(u.email).digest()[0]%64);
    await owner.query("insert into devfit_rate(id,hits,reset_at) values($1,6001,extract(epoch from now())::bigint+3600) on conflict(id) do update set hits=excluded.hits,reset_at=excluded.reset_at",[ipBucket]);
    const sharedNetworkPrefs=(await load(u,'prefs')).value.rows[0];
    assert.equal((await save(u,'prefs',{probe:'busy-network'},sharedNetworkPrefs.updated_at)).status,200);
    await owner.query('delete from devfit_rate where id=$1',[ipBucket]);
    check('busy shared-network traffic above the old shard quota does not block a legitimate account');
    const shadowBefore=(await owner.query("select record_key,updated_at::text stamp from devfit_records where email=$1 and data_type='nutrition_day' order by record_key",[u.email])).rows;
    const nr=(await load(u,'nutrition')).value.rows[0];
    const changed=structuredClone(nr.data);changed.days['2026-09-22'].meals[0].foods[0].grams++;
    assert.equal((await save(u,'nutrition',changed,nr.updated_at)).status,200);
    const shadowAfter=(await owner.query("select record_key,updated_at::text stamp from devfit_records where email=$1 and data_type='nutrition_day' order by record_key",[u.email])).rows;
    assert.equal(shadowAfter.filter((r,i)=>r.stamp!==shadowBefore[i].stamp).length,1);
    check('one changed food day updates exactly one shadow row out of 84');
    const same=(await load(u,'nutrition')).value.rows[0];
    const unchanged=await save(u,'nutrition',same.data,same.updated_at);
    assert.equal(unchanged.value.unchanged,true);assert.equal(unchanged.value.updated_at,same.updated_at);
    check('unchanged retries keep the same document version');
    const privilege=(await owner.query("select has_function_privilege('anon','public.save_devfit_data_atomic(text,text,jsonb,text,text,text)','EXECUTE') anon,has_function_privilege('authenticated','public.load_devfit_account(text,text)','EXECUTE') authenticated")).rows[0];
    assert.equal(privilege.anon,false);assert.equal(privilege.authenticated,false);
    const securityClient=await owner.connect();
    try{
      await securityClient.query('begin');
      await securityClient.query('grant select on devfit_data to anon');
      await securityClient.query('set local role anon');
      assert.equal((await securityClient.query('select count(*)::int n from devfit_data')).rows[0].n,0);
    }finally{await securityClient.query('rollback');securityClient.release();}
    check('RPC access denied to browser roles; RLS hides rows even with accidental SELECT grant');
    const bad=makeDoc('workouts');bad.sessions.push({...bad.sessions[0],date:'2026-02-31'});
    const bw=(await load(u,'workouts')).value.rows[0];
    assert.equal((await save(u,'workouts',bad,bw.updated_at)).status,200);
    check('duplicate session ids and invalid date cannot break whole save');
    const p=(await load(u,'prefs')).value.rows[0];
    assert.equal((await save(u,'prefs',{large:'x'.repeat(70000)},p.updated_at)).status,413);
    check('oversized account input rejected');
    const attempts=await Promise.all(Array.from({length:5},(_,i)=>pool.query(
      "select check_devfit_security_access($1,$2,$3,'scale','/api/verify',true,true,false) result",[u.email,`concurrent-new-device-${i}`,crypto.createHash('sha256').update('IP').digest('hex')])));
    assert.equal(attempts.filter(r=>r.rows[0].result.status==='ok').length,2);
    check('concurrent registrations enforce three active devices');
  }

  if(soakSeconds && !baseline){
    const samples=[];const accepted=new Map();const started=performance.now();let round=revision;
    // 2000 active users, each changes a value every 30s (~67 writes/s),
    // evenly staggered. This is an arrival schedule, not a closed-loop ceiling.
    const end=performance.now()+soakSeconds*1000;const inFlight=new Set();
    let issued=0,missedSchedule=0;
    const heartbeat=setInterval(()=>console.log(JSON.stringify({phase:'sustained',issued,inFlight:inFlight.size,rssBytes:process.memoryUsage().rss})),10000);
    while(performance.now()<end){
      const scheduled=started+issued*(30000/count); const now=performance.now();
      if(now<scheduled)await sleep(scheduled-now);
      if(performance.now()-scheduled>1000)missedSchedule++;
      const index=issued%count, type=docs[index%3].type, user=users[index];
      round=revision+2+Math.floor(issued/count);
      const next=round;
      const task=(async()=>{const read=await load(user,type);samples.push(metric(read));
        if(read.status===200){const written=await save(user,type,makeDoc(type,next),read.value.rows[0].updated_at);
          samples.push(metric(written));if(written.status===200)accepted.set(user.email+'|'+type,next);}})();
      inFlight.add(task);task.finally(()=>inFlight.delete(task));issued++;
    }
    const queueAtEnd=inFlight.size,drainStarted=performance.now();
    await Promise.all(inFlight);
    clearInterval(heartbeat);
    const scenario={name:'staggered sustained workload',concurrency:count,sharedIP:true,seconds:soakSeconds,issued,missedSchedule,
      queueAtEnd,drainSeconds:+((performance.now()-drainStarted)/1000).toFixed(2),
      requests:samples.length,statuses:statuses(samples),failed:samples.filter(r=>r.status!==r.expected).length,p95Ms:Math.round(percentile(samples.map(r=>r.ms),.95)),p99Ms:Math.round(percentile(samples.map(r=>r.ms),.99))};
    report.scenarios.push(scenario);console.log(JSON.stringify(scenario));
    const stored=(await owner.query("select email,data_type,(data->>'scaleRevision')::int revision from devfit_data where email ~ '^scale-[0-9]+@example[.]invalid$' and data_type<>'prefs'")).rows;
    for(const row of stored){const expected=accepted.get(row.email+'|'+row.data_type);
      if(expected!=null)assert.ok(row.revision>=expected,'Accepted sustained save must survive read-back');}
    check('accepted sustained saves remain in PostgreSQL', {documents:accepted.size});
  }
  report.database=(await owner.query("select relname,n_live_tup,n_dead_tup,pg_total_relation_size(relid)::bigint bytes from pg_stat_user_tables where schemaname='public' order by relname")).rows;
  report.memory=process.memoryUsage(); report.loopDelayP99Ms=+(loopDelay.percentile(99)/1e6).toFixed(1);
  report.complete=true;
  report.sloMet=report.scenarios.every(s=>s.actions
    ? Object.values(s.actions).every(a=>a.p95Ms<=report.latencyTargetMs.p95 && a.p99Ms<=report.latencyTargetMs.p99)
    : s.p95Ms<=report.latencyTargetMs.p95 && (!s.p99Ms || s.p99Ms<=report.latencyTargetMs.p99));
  report.passed=report.sloMet && report.scenarios.every(s=>!s.incorrectReadBack && !(s.failed||0) && (!s.actions || Object.values(s.actions).every(a=>a.failed===0))) && report.errors.length===0;
} catch(e){report.passed=false;report.failure={name:e.name,message:e.message};console.error(e);process.exitCode=1;}
finally{
  loopDelay.disable();
  report.memory=process.memoryUsage();report.loopDelayP99Ms=+(loopDelay.percentile(99)/1e6).toFixed(1);
  report.rpcLatency=Object.fromEntries(Object.entries(report.rpcLatency).map(([k,v])=>[k,{calls:v.length,p50Ms:Math.round(percentile(v,.5)),p95Ms:Math.round(percentile(v,.95)),p99Ms:Math.round(percentile(v,.99))}]));
  await fs.mkdir(new URL('results/',import.meta.url),{recursive:true});
  const output=new URL(`results/${label}.json`,import.meta.url);
  await fs.writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:output.pathname,passed:report.passed}));
  apiServer?.closeAllConnections();gateway?.closeAllConnections();apiServer?.close();gateway?.close();
  await Promise.all([pool.end(),owner.end()]);
  if(!report.passed)process.exitCode=1;
}
