// Local-only PostgreSQL contention probe. No upstream provider is called.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
const url=new URL(process.env.DEVFIT_SCALE_DATABASE_URL||'');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/devfit_scale/);
const pool=new pg.Pool({connectionString:url.href,max:10});
const prefix='food-qa-'+crypto.randomUUID();
const emailPrefix=prefix+'-account-';
try{
  assert.equal((await pool.query('select count(*)::int n from devfit_scale_environment')).rows[0].n,1);
  // Own fixtures make this test independent of the capacity harness or its seed.
  await pool.query("insert into devfit_subscribers(email,name,tier,approved) select $1||n||'@example.invalid','Food cache QA','free',true from generate_series(1,1000) n",[emailPrefix]);
  await pool.query("insert into devfit_logins(email,device_id,user_agent) select email,'food-cache-device-'||md5(email),'Food concurrency QA' from devfit_subscribers where email like $1",[emailPrefix+'%@example.invalid']);
  const start=performance.now();
  const result=await Promise.all(Array.from({length:1000},()=>pool.query('select claim_devfit_food_cache($1,$2,1000,60) result',[prefix,'kalori'])));
  const grants=result.map(r=>r.rows[0].result).filter(r=>r.status==='fetch');assert.equal(grants.length,1,'Exactly one cross-instance fetch lease');
  assert.ok(result.every(r=>['fetch','busy'].includes(r.rows[0].result.status)));
  const leaseMs=Math.round(performance.now()-start);
  await pool.query('select finish_devfit_food_cache($1,$2,$3::jsonb,true)',[prefix,grants[0].lease,JSON.stringify([{name:'Synthetic shared food'}])]);
  const cached=await Promise.all(Array.from({length:1000},()=>pool.query('select claim_devfit_food_cache($1,$2,1000,60) result',[prefix,'kalori'])));
  assert.ok(cached.every(r=>r.rows[0].result.status==='cached'&&r.rows[0].result.items[0].name==='Synthetic shared food'));
  const accounts=(await pool.query("select s.email,l.device_id from devfit_subscribers s join devfit_logins l on l.email=s.email where s.email like $1 order by s.email",[emailPrefix+'%@example.invalid'])).rows;
  assert.equal(accounts.length,1000);
  const authorized=await Promise.all(accounts.map(u=>pool.query('select authorize_devfit_food_search($1,$2,$3,true,$4) result',[u.email,u.device_id,'c'.repeat(64),'Food concurrency QA'])));
  assert.ok(authorized.every(r=>r.rows[0].result.status==='ok'),'Shared-IP quota must allow 1000 separate signed accounts');
  for(let i=0;i<520;i++){
    const key=prefix+'-'+i;const r=(await pool.query('select claim_devfit_food_cache($1,$2,1000,60) result',[key,'kalori'])).rows[0].result;
    assert.equal(r.status,'fetch');await pool.query('select finish_devfit_food_cache($1,$2,$3::jsonb,true)',[key,r.lease,'[]']);
  }
  const rows=(await pool.query('select count(*)::int n from devfit_food_cache')).rows[0].n;assert.ok(rows<=512);
  console.log(JSON.stringify({concurrentRequests:1000,fetchLeases:grants.length,leaseBurstMs:leaseMs,cacheHits:1000,authorizedSharedIPAccounts:1000,cacheRows:rows,cloudCapacityVerified:false}));
}finally{
  await pool.query('delete from devfit_food_cache where cache_key=$1 or cache_key like $2',[prefix,prefix+'-%']);
  await pool.query('delete from devfit_logins where email like $1',[emailPrefix+'%@example.invalid']);
  await pool.query('delete from devfit_subscribers where email like $1',[emailPrefix+'%@example.invalid']);
  await pool.end();
}
