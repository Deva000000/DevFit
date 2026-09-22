import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DEVFIT_JWT_SECRET = 'payment-test-secret';
process.env.SUPABASE_SERVICE_KEY = 'payment-test-service';
const { default: handler } = await import('../api/payments.js?payment-tests');

function token(email='payer@gmail.com') {
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({email})).toString('base64url');
  const s=crypto.createHmac('sha256',process.env.DEVFIT_JWT_SECRET).update(h+'.'+p).digest('base64url');
  return h+'.'+p+'.'+s;
}
function capture(){const out={headers:{}};return {out,setHeader(k,v){out.headers[k]=v;},status(v){out.status=v;return this;},json(v){out.body=v;}};}
async function run(method,body={},signed=true){
  const res=capture();
  await handler({method,body,headers:{host:'devfitportal.vercel.app',origin:'https://devfitportal.vercel.app',...(signed?{authorization:'Bearer '+token()}: {})},socket:{remoteAddress:'127.0.0.1'}},res);
  return res.out;
}

test('payment history requires a signed account and never trusts a body email',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unsigned request reached storage');};
  try{const r=await run('GET',{},false);assert.equal(r.status,401);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

test('customer payment history exposes metadata but never receipt paths',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const u=String(url);
    if(u.includes('/devfit_subscribers?'))return {ok:true,json:async()=>[{approved:true}]};
    if(u.includes('/devfit_payments?'))return {ok:true,json:async()=>[{id:'1',reference:'DEVFIT_SEP26_PAYER',status:'pending',byte_size:120000,uploaded_at:'2026-09-22T01:00:00Z'}]};
    throw new Error('unexpected '+u);
  };
  try{const r=await run('GET',{email:'victim@gmail.com'});assert.equal(r.status,200);assert.equal(r.body.reference,'DEVFIT_SEP26_PAYER');assert.equal(r.body.payments[0].storage_path,undefined);}finally{globalThis.fetch=original;}
});

test('valid receipt is rate-limited, stored privately and linked to signed Gmail',async()=>{
  const original=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options={})=>{
    const u=String(url),method=options.method||'GET';requests.push({u,method,body:options.body});
    if(u.includes('/devfit_subscribers?'))return {ok:true,json:async()=>[{approved:true}]};
    if(u.includes('/rpc/consume_devfit_rate_limit'))return {ok:true,json:async()=>({allowed:true,retry_after:0})};
    if(u.includes('/devfit_payments?')&&method==='GET')return {ok:true,json:async()=>[]};
    if(u.includes('/storage/v1/object/devfit-payment-proofs/')&&method==='POST')return {ok:true,json:async()=>({})};
    if(u.endsWith('/rest/v1/devfit_payments')&&method==='POST'){
      const row=JSON.parse(options.body);assert.equal(row.email,'payer@gmail.com');assert.equal(row.status,'pending');assert.match(row.storage_path,/^[0-9a-f]{24}\/[0-9a-f-]{36}\.jpg$/);
      return {ok:true,json:async()=>[{...row,uploaded_at:'2026-09-22T01:00:00Z'}]};
    }
    throw new Error('unexpected '+method+' '+u);
  };
  const jpeg=Buffer.from('ffd8ffdb0011223344','hex');
  try{
    const r=await run('POST',{email:'victim@gmail.com',image:'data:image/jpeg;base64,'+jpeg.toString('base64')});
    assert.equal(r.status,201);assert.equal(r.body.ok,true);assert.equal(r.body.payment.storage_path,undefined);
    assert.equal(requests.some(x=>x.u.includes('victim')),false);
  }finally{globalThis.fetch=original;}
});

test('non-image payloads are rejected before private storage',async()=>{
  const original=globalThis.fetch;let storageWrites=0;
  globalThis.fetch=async(url)=>{
    const u=String(url);
    if(u.includes('/devfit_subscribers?'))return {ok:true,json:async()=>[{approved:true}]};
    if(u.includes('/rpc/consume_devfit_rate_limit'))return {ok:true,json:async()=>({allowed:true,retry_after:0})};
    if(u.includes('/storage/v1/object/'))storageWrites++;
    return {ok:true,json:async()=>({})};
  };
  try{const r=await run('POST',{image:'data:image/jpeg;base64,'+Buffer.from('not-an-image').toString('base64')});assert.equal(r.status,400);assert.equal(storageWrites,0);}finally{globalThis.fetch=original;}
});
