// Independent SQL connections compete for durable retry jobs. Never targets
// cloud/customer databases and never calls an email provider.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
const url=new URL(process.env.DEVFIT_SCALE_DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Local databases only');
assert.match(url.pathname,/^\/devfit_scale[a-z0-9_]*$/);
const db=new pg.Pool({connectionString:url.toString(),max:10});
const email='notification-concurrency@example.invalid',token=crypto.randomBytes(32).toString('hex');
try {
  assert.equal((await db.query('select count(*)::int n from devfit_scale_environment')).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from devfit_notification_outbox where state in ('pending','leased')")).rows[0].n,0,
    'Use a fresh isolated schema; do not claim jobs belonging to another local QA run');
  await db.query("insert into devfit_job_auth(name,token_hash,enabled)values('notifications',$1,true)",[crypto.createHash('sha256').update(token).digest('hex')]);
  await db.query("insert into devfit_subscribers(email,approved,tier)values($1,true,'free')",[email]);
  for(let i=0;i<8;i++)await db.query("insert into devfit_support_requests(email,whatsapp,category,message)values($1,'60123456789','feedback','Synthetic concurrency probe')",[email]);
  await db.query("update devfit_notification_outbox set next_attempt_at=now()-interval '1 second' where support_id in(select id from devfit_support_requests where email=$1)",[email]);
  const contenders=await Promise.all(Array.from({length:100},async()=>{
    const {rows}=await db.query('select claim_devfit_notifications($1) result',[token]);
    assert.equal(rows[0].result.status,'ok');return rows[0].result.jobs;
  }));
  const jobs=contenders.flat();assert.equal(jobs.length,8);assert.equal(new Set(jobs.map(j=>j.id)).size,8);
  const outcomes=await Promise.all(jobs.map(async j=>{
    const result=await db.query("select finish_devfit_notification($1,$2,true,'synthetic-message',null) result",[j.id,j.lease_id]);
    assert.equal(result.rows[0].result.status,'sent');
    // Response lost after the COMMIT: retrying must not downgrade a delivered
    // record, even if a late/stale worker reports an error.
    const retry=await db.query("select finish_devfit_notification($1,$2,false,null,'late_failure') result",[j.id,j.lease_id]);
    return retry.rows[0].result.status;
  }));
  assert.ok(outcomes.every(s=>s==='sent'));
  assert.equal((await db.query("select count(*)::int n from devfit_support_requests where email=$1 and email_status='sent'",[email])).rows[0].n,8);
  console.log(JSON.stringify({contenders:100,jobs:8,duplicateClaims:0,acceptedCompletions:8,lateFailuresCannotDowngrade:true,externalEmailCalls:0}));
} finally {
  await db.query('select delete_devfit_account($1)',[email]);
  await db.query("delete from devfit_job_auth where name='notifications' and token_hash=$1",[crypto.createHash('sha256').update(token).digest('hex')]);
  await db.end();
}
