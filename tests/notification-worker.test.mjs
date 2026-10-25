import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEVFIT_JWT_SECRET='notification-tests-only';
process.env.SUPABASE_SERVICE_KEY='notification-tests-only';
process.env.DEVFIT_ADMIN_PASSWORD='notification-owner-tests-only';
process.env.RESEND_API_KEY='notification-provider-tests-only';
const {default:handler}=await import('../api/admin.js');
const token='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
const job={id,lease_id:'00000000-0000-4000-8000-000000000002',support_id:id,payment_id:null};
async function request(headers={},body={}) {
  let status,value;await handler({method:'POST',headers,body},
    {setHeader(){},status(s){status=s;return this;},json(v){value=v;}});
  return {status,value};
}
const response=value=>({ok:true,json:async()=>value});

test('job capability cannot bypass owner authentication or accept browser cookies/origin',async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('not allowed');};
  try {
    for(const headers of [{'x-devfit-job':'wrong'},{'x-devfit-job':token,origin:'https://devfitportal.vercel.app'},
      {'x-devfit-job':token,cookie:'devfit_admin_session=anything'}]) {
      const r=await request(headers,{action:'activate',email:'other@example.invalid'});assert.equal(r.status,401);
    }
    assert.equal(calls,0);
    assert.equal((await request({host:'devfitportal.vercel.app',origin:'https://devfitportal.vercel.app'}, {action:'list'})).status,401);
  } finally {globalThis.fetch=old;}
});

test('well-formed wrong scheduler key cannot read tickets or send emails',async()=>{
  const old=globalThis.fetch,calls=[];globalThis.fetch=async(u)=>{calls.push(String(u));return response({status:'unauthorized'});};
  try {
    assert.equal((await request({'x-devfit-job':token})).status,401);
    assert.equal(calls.length,1);assert.match(calls[0],/claim_devfit_notifications$/);
  } finally {globalThis.fetch=old;}
});

test('worker only sends existing notifications to the fixed owner, and returns counts',async()=>{
  const old=globalThis.fetch,calls=[];let finished;
  globalThis.fetch=async(u,o={})=>{
    const url=String(u);calls.push(url);
    if(url.endsWith('/claim_devfit_notifications'))return response({status:'ok',jobs:[job]});
    if(url.includes('/devfit_support_requests?'))return response([{id,email:'synthetic@example.invalid',whatsapp:'60123456789',
      category:'feedback',message:'Synthetic local test only',created_at:'2026-10-26T00:00:00Z',email_status:'failed'}]);
    if(url==='https://api.resend.com/emails'){
      const mail=JSON.parse(o.body);assert.deepEqual(mail.to,['devaa1024@gmail.com']);
      assert.equal(o.headers['Idempotency-Key'],'devfit-support/'+id);
      return response({id:'provider-message'});
    }
    if(url.endsWith('/finish_devfit_notification')){finished=JSON.parse(o.body);return response({status:'sent'});}
    throw Error('unexpected URL '+url);
  };
  try {
    const r=await request({'x-devfit-job':token},{action:'activate',email:'victim@example.invalid',to:'attacker@example.invalid'});
    assert.equal(r.status,200);assert.deepEqual(r.value,{ok:true,claimed:1,sent:1,pending:0});
    assert.equal(finished.p_ok,true);assert.equal(finished.p_lease_id,job.lease_id);
    assert.equal(JSON.stringify(r.value).includes('@'),false);assert.equal(calls.length,4);
  } finally {globalThis.fetch=old;}
});

test('provider outage records retry state without leaking the provider error',async()=>{
  const old=globalThis.fetch;let finished;
  globalThis.fetch=async(u,o={})=>{
    const url=String(u);
    if(url.endsWith('/claim_devfit_notifications'))return response({status:'ok',jobs:[job]});
    if(url.includes('/devfit_support_requests?'))return response([{id,email:'synthetic@example.invalid',category:'feedback',message:'QA',email_status:'failed'}]);
    if(url==='https://api.resend.com/emails')throw Error('private diagnostic details');
    if(url.endsWith('/finish_devfit_notification')){finished=JSON.parse(o.body);return response({status:'pending'});}
    throw Error('unexpected');
  };
  try {
    const r=await request({'x-devfit-job':token});assert.equal(r.value.pending,1);
    assert.equal(finished.p_ok,false);assert.equal(finished.p_error,'email_provider_unavailable');
    assert.equal(JSON.stringify(r.value).includes('private'),false);
  } finally {globalThis.fetch=old;}
});

test('missing storage leaves the durable lease retryable and never emails invented content',async()=>{
  const old=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async u=>{
    if(String(u).endsWith('/claim_devfit_notifications'))return response({status:'ok',jobs:[job]});
    if(String(u).includes('/devfit_support_requests?'))return response([]);
    providerCalls++;throw Error('must not send');
  };
  try {assert.equal((await request({'x-devfit-job':token})).value.pending,1);assert.equal(providerCalls,0);}
  finally {globalThis.fetch=old;}
});
