import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_SERVICE_KEY='synthetic';process.env.DEVFIT_JWT_SECRET='food-qa';
const {signToken}=await import('../api/_lib.js');
const {cachedFood}=await import('../api/_food-cache.js');
const {default:off}=await import('../api/off.js');
const {default:kalori}=await import('../api/kalori.js');
const capture=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;}});
const req=query=>({method:'GET',headers:{authorization:'Bearer '+signToken({email:'qa@example.invalid'})},query:{query,q:query}});
test('disabled unhealthy provider never calls its upstream or bypasses account authorization',async()=>{
  const original=fetch;let calls=0;
  globalThis.fetch=async url=>{assert.match(String(url),/authorize_devfit_food_search/);calls++;return {ok:true,json:async()=>({status:'ok'})};};
  try{const r=capture();await kalori(req('rice'),r);assert.equal(r.body.error,'source_disabled');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('shared cache results skip upstream fetches and never need an account credential in their key',async()=>{
  const original=fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{assert.match(String(url),/claim_devfit_food_cache/);const b=JSON.parse(options.body);assert.match(b.p_key,/^off:v2:[a-f0-9]{64}$/);calls++;return {ok:true,json:async()=>({status:'cached',items:[{name:'Cached'}]})};};
  try{const result=await cachedFood('shared-test',()=>{throw Error('upstream should not run');},{shared:true,provider:'off',limit:9,windowSeconds:60});assert.equal(result[0].name,'Cached');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('branded results include genuine zero-calorie products but never leak unnecessary provider fields',async()=>{
  const original=fetch;
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('authorize_devfit_food_search')?{status:'ok'}:
    String(url).includes('claim_devfit_food_cache')?{status:'fetch',lease:'00000000-0000-4000-8000-000000000001'}:
    String(url).includes('finish_devfit_food_cache')?{ok:true}:{hits:[{product_name:'Water',internal:'not needed',nutriments:{'energy-kcal_100g':0,proteins_100g:0,'salt_100g':5}}]}});
  try{const r=capture();await off(req('zero-calorie-test'),r);assert.equal(r.body.products.length,1);assert.equal(r.body.products[0].nutriments['energy-kcal_100g'],0);assert.equal(r.body.products[0].internal,undefined);assert.equal(r.body.products[0].nutriments.salt_100g,undefined);}finally{globalThis.fetch=original;}
});
test('provider budget exhaustion is a retry state, not a fabricated outage or empty success',async()=>{
  const original=fetch;let upstream=0;
  globalThis.fetch=async url=>{
    if(String(url).includes('authorize_devfit_food_search'))return{ok:true,json:async()=>({status:'ok'})};
    if(String(url).includes('claim_devfit_food_cache'))return{ok:true,json:async()=>({status:'limited',items:null,retryAfter:30})};
    upstream++;throw Error('must not fetch');
  };
  try{const r=capture();await off(req('limited-test'),r);assert.equal(r.body.error,'food_search_busy');assert.equal(r.headers['Retry-After'],'30');assert.equal(upstream,0);}finally{globalThis.fetch=original;}
});
test('food UI does not pretend to search while idle or query the known-broken provider',()=>{
  const html=fs.readFileSync(new URL('../nutrition.html',import.meta.url),'utf8');
  assert.match(html,/Press Search or Enter to search online/);assert.doesNotMatch(html,/const sources=\[[^\]]*kaloriSearch/);
});
