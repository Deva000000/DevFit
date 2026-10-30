import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.DEVFIT_JWT_SECRET='session-lifecycle-only';
process.env.SUPABASE_SERVICE_KEY='session-lifecycle-only';
const lib=await import('../api/_lib.js');
const {default:pro}=await import('../api/pro-access.js');
const {default:session}=await import('../api/session.js');
const {default:health}=await import('../api/health.js');
const {default:verify}=await import('../api/verify.js');
const device='session-lifecycle-device';
const claims={email:'session@example.invalid',did:lib.sha256Hex(device),sid:'e'.repeat(64)};
const capture=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;}});

test('JWT expiry, future issuance, tampering and legacy acceptance are explicit',()=>{
  const clock=Date.now;const start=Date.now();
  try{
    Date.now=()=>start;const t=lib.signToken(claims,1);
    assert.equal(lib.verifyToken(t).email,claims.email);
    assert.equal(lib.verifyToken(t+'x'),null);
    Date.now=()=>start+2000;assert.equal(lib.verifyToken(t),null);
    assert.equal(lib.verifyToken(t,{allowLegacy:true}),null,'legacy mode never ignores expiry');
    Date.now=()=>start;const old=lib.signToken({email:claims.email},null);
    assert.equal(lib.verifyToken(old),null);
    assert.equal(lib.verifyToken(old,{allowLegacy:true}).email,claims.email);
    Date.now=()=>start-120000;assert.equal(lib.verifyToken(t),null);
  }finally{Date.now=clock;}
});

test('current Pro authorization is one bounded DB request and honors account quota',async()=>{
  const old=fetch;let calls=0;
  globalThis.fetch=async(u,o)=>{
    calls++;assert.match(String(u),/authorize_devfit_session$/);
    const b=JSON.parse(o.body);assert.equal(b.p_email,claims.email);assert.equal(b.p_session_hash,lib.sha256Hex(claims.sid));
    return{ok:true,json:async()=>({status:'rate_limited',retryAfter:22})};
  };
  try{
    const r=capture();await pro({method:'POST',headers:{authorization:'Bearer '+lib.signToken(claims)},body:{deviceId:device}},r);
    assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'22');assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
});

test('unbound sessions and copied device tokens never reach privileged DB work',async()=>{
  const old=fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
  try{
    for(const p of [{email:claims.email},claims]){
      const r=capture();await pro({method:'POST',headers:{authorization:'Bearer '+lib.signToken(p)},body:{deviceId:'a-different-device-id'}},r);
      assert.equal(r.code,401);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});

test('logout revokes only the authenticated session and does not accept a claimed email',async()=>{
  const old=fetch;let calls=0;globalThis.fetch=async(u,o)=>{
    calls++;assert.match(String(u),/revoke_devfit_session$/);
    const b=JSON.parse(o.body);assert.equal(b.p_email,claims.email);assert.equal(b.p_session_hash,lib.sha256Hex(claims.sid));
    return{ok:true,json:async()=>({status:'ok'})};
  };
  try{
    const r=capture();await session({method:'POST',headers:{authorization:'Bearer '+lib.signToken(claims)},body:{op:'logout',deviceId:device,email:'victim@example.invalid'}},r);
    assert.equal(r.code,200);assert.equal(r.body.ok,true);assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
});

test('a public health burst coalesces DB probes and the CDN caches only non-personal status',async()=>{
  const old=fetch;let calls=0;globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return{ok:true,json:async()=>({ok:true,syncProtocol:2})};};
  try{
    const results=await Promise.all(Array.from({length:100},async()=>{const r=capture();await health({method:'GET'},r);return r;}));
    assert.equal(calls,1);assert(results.every(r=>r.code===200&&r.headers['Cache-Control'].includes('s-maxage=15')));
    assert(results.every(r=>!JSON.stringify(r.body).includes('email')));
  }finally{globalThis.fetch=old;}
});

test('workout allocation and nested numeric input cannot exceed safe bounds',()=>{
  const c={};c.globalThis=c;vm.runInNewContext(fs.readFileSync(new URL('../input-limits.js',import.meta.url),'utf8'),c);
  for(const n of [-1,0,1.5,10000,'1e9',Infinity,NaN,'<img src=x>']){
    assert.equal(c.DevFitLimits.valid('tSets',n),false);assert.equal(c.DevFitLimits.safeSetCount(n),3);
  }
  assert.equal(c.DevFitLimits.safeSetCount(30),30);
  assert.equal(c.DevFitLimits.validTree({plan:{workouts:[{exercises:[{tSets:10000}]}]}}),false);
  assert.equal(c.DevFitLimits.validTree({plan:{workouts:[{exercises:[{tSets:3,tMin:60,tKm:10.5}]}]}}),true);
});

test('a session-store outage during legacy upgrade is not misreported as revocation',async()=>{
  const original=fetch;globalThis.fetch=async u=>String(u).endsWith('/check_devfit_security_access')
    ?{ok:true,json:async()=>({status:'ok'})}:{ok:false};
  try{
    const token=lib.signToken({email:claims.email,did:claims.did},null),r=capture();
    await verify({method:'POST',headers:{},body:{token,deviceId:device}},r);
    assert.equal(r.code,503);assert.equal(r.body.approved,undefined);
  }finally{globalThis.fetch=original;}
});

test('first signup cannot overwrite a concurrent owner activation or revocation',async()=>{
  const original=fetch,pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const now=Math.floor(Date.now()/1000),head=b64({alg:'RS256',kid:'signup-race'});
  const body=b64({iss:'https://accounts.google.com',aud:'94871311791-ql8k9lo0q9e1uq3ri98ghnfr1m187chh.apps.googleusercontent.com',
    sub:'synthetic-race',email:claims.email,email_verified:true,iat:now,exp:now+300});
  const credential=head+'.'+body+'.'+crypto.sign('RSA-SHA256',Buffer.from(head+'.'+body),pair.privateKey).toString('base64url');
  try{
    for(const approved of [true,false]){
      let reads=0,inserted=false;
      globalThis.fetch=async(u,o={})=>{
        const url=String(u);
        if(url.includes('/oauth2/v3/certs'))return{ok:true,headers:{get:()=> 'max-age=3600'},json:async()=>({keys:[{...pair.publicKey.export({format:'jwk'}),kid:'signup-race'}]})};
        if(url.endsWith('/consume_devfit_rate_limit'))return{ok:true,json:async()=>({allowed:true})};
        if(url.endsWith('/check_devfit_security_access'))return{ok:true,json:async()=>({status:'ok',deviceHash:claims.did})};
        if(url.includes('/devfit_subscribers?')&&o.method==='POST'){
          assert.match(o.headers.Prefer,/ignore-duplicates/);inserted=true;return{ok:true};
        }
        if(url.includes('/devfit_subscribers?')){reads++;return{ok:true,json:async()=>reads===1?[]:[{email:claims.email,tier:'pro',approved,expiry:'2099-12-31'}]};}
        if(url.endsWith('/start_devfit_account_session'))return{ok:true,json:async()=>({status:'ok'})};
        throw Error('Unexpected signup race request: '+url);
      };
      const r=capture();await session({method:'POST',headers:{},body:{provider:'google_id',token:credential,deviceId:device}},r);
      assert.equal(inserted,true);assert.equal(r.code,200);assert.equal(r.body.approved,approved);
      if(approved)assert.equal(r.body.tier,'pro');else assert.equal(r.body.token,undefined);
    }
  }finally{globalThis.fetch=original;}
});
