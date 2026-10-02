import test from 'node:test';
import assert from 'node:assert/strict';

test('repeated outage reports do not amplify database load, and fallback is bounded',async()=>{
  process.env.SUPABASE_SERVICE_KEY='synthetic';process.env.DEVFIT_JWT_SECRET='synthetic';
  const original=globalThis.fetch,log=console.error;const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,signal:options.signal});return{ok:false};};
  console.error=()=>{};
  try{
    const {recordServerEvent}=await import('../api/_lib.js?monitor-pressure');
    await Promise.all(Array.from({length:2000},()=>recordServerEvent('data_failure','Synthetic outage',{status:503,page:'/api/data'})));
    assert.equal(calls.length,2,'Only one RPC and one compatibility fallback for the identical burst');
    assert.ok(calls.every(c=>c.signal),'Both writes must have deadlines');
    await recordServerEvent('data_failure','Different failure',{status:500,page:'/api/data'});
    assert.equal(calls.length,4,'Distinct failures must still be recorded');
  }finally{globalThis.fetch=original;console.error=log;}
});
