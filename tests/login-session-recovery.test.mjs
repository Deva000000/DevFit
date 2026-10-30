import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.DEVFIT_JWT_SECRET='synthetic-browser-session-tests-only';
process.env.SUPABASE_SERVICE_KEY='synthetic-browser-session-tests-only';
const lib=await import('../api/_lib.js');
const cookies=await import('../api/_browser-session.js');
const {default:session}=await import('../api/session.js');
const {default:callback}=await import('../api/google-login.js');
const authSource=fs.readFileSync(new URL('../devfit-auth.js',import.meta.url),'utf8');
const device='synthetic-installation-1234';
const payload={email:'one@example.invalid',sid:'a'.repeat(64),did:lib.sha256Hex(device)};
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;},send(v){this.body=v;}};}
function cookieHeader(p=payload){const r=response();const context=cookies.setBrowserSession(r,p,device);return r.headers['Set-Cookie'].split(';')[0]+'; __Host-devfit_active='+context;}
function client(fetch,initial=true){
  const storage=new Map(initial?[
    ['devfit_user',JSON.stringify({email:payload.email,approved:true,tier:'pro'})],
    ['devfit_token','old-token'],['devfit_ns_migrated','1'],['devfit_device_id',device]
  ]:[]);
  const events={};const c={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    fetch,crypto:{randomUUID:()=>device},self:{crypto:{}},setTimeout:()=>0,clearTimeout(){},
    location:{href:'',replace(v){this.href=v;},reload(){}},document:{cookie:'',createElement:()=>({style:{}})},
    addEventListener:(k,f)=>events[k]=f,alert(){},console};c.window=c;
  vm.createContext(c);vm.runInContext(authSource,c);return{c,storage,events};
}
const ok=data=>({ok:true,status:200,json:async()=>data});
test('bootstrap cookie is HttpOnly, purpose-separated and requires matching active account context',()=>{
  const r=response(),context=cookies.setBrowserSession(r,payload,device);
  assert.match(r.headers['Set-Cookie'],/; Secure; HttpOnly; SameSite=Lax/);
  const raw=r.headers['Set-Cookie'].split(';')[0];
  assert.equal(lib.verifyToken(raw.split('=')[1]).email,undefined,'Cookie is not an API bearer');
  assert.equal(cookies.readBrowserSession({headers:{cookie:raw}}),null);
  assert.equal(cookies.readBrowserSession({headers:{cookie:raw+'; __Host-devfit_active='+ 'b'.repeat(64)}}),null);
  assert.equal(cookies.readBrowserSession({headers:{cookie:raw+'; __Host-devfit_active='+context}}).email,payload.email);
  assert.equal(cookies.readBrowserSession({headers:{cookie:raw+'x; __Host-devfit_active='+context}}),null);
});
test('restore checks origin, current session, bans and current tier; body email/device is ignored',async()=>{
  const original=fetch;let calls=0;
  globalThis.fetch=async(u,o)=>{
    calls++;assert.match(String(u),/authorize_devfit_session$/);
    const b=JSON.parse(o.body);assert.equal(b.p_email,payload.email);assert.equal(b.p_device_id,device);
    return ok({status:'ok',subscriber:{email:payload.email,approved:true,tier:'free'}});
  };
  try{
    for(const origin of [undefined,'https://evil.invalid']){
      const r=response();await session({method:'POST',headers:{host:'devfit.test',origin,cookie:cookieHeader()},body:{op:'restore'}},r);
      assert.equal(r.code,403);assert.equal(calls,0);
    }
    const r=response();await session({method:'POST',headers:{host:'devfit.test',origin:'https://devfit.test',cookie:cookieHeader()},
      body:{op:'restore',email:'victim@example.invalid',deviceId:'forged-installation'}},r);
    assert.equal(calls,1);assert.equal(r.body.email,payload.email);assert.equal(r.body.tier,'free');assert.equal(r.body.deviceId,device);
    assert.equal(lib.verifyToken(r.body.token).email,payload.email);
    globalThis.fetch=async()=>ok({status:'revoked'});
    const denied=response();await session({method:'POST',headers:{host:'devfit.test',origin:'https://devfit.test',cookie:cookieHeader()},body:{op:'restore'}},denied);
    assert.equal(denied.code,401);assert.equal(denied.body.token,undefined);
  }finally{globalThis.fetch=original;}
});
test('late response cookie from A cannot restore A after B was accepted',()=>{
  const a=response(),b=response();cookies.setBrowserSession(a,payload,device);
  const bPayload={...payload,email:'two@example.invalid',sid:'b'.repeat(64)};
  const bContext=cookies.setBrowserSession(b,bPayload,device);
  const late=a.headers['Set-Cookie'].split(';')[0]+'; __Host-devfit_active='+bContext;
  assert.equal(cookies.readBrowserSession({headers:{cookie:late}}),null);
});
test('iOS callback preserves every actionable login failure rather than flattening to denied',async()=>{
  for(const error of ['device_limit','device_storage_unavailable','rate_limited','account_blocked','invalid_identity','account_store_unavailable']){
    const r=response();await callback({method:'POST',headers:{cookie:'g_csrf_token=qa'},body:{g_csrf_token:'qa',credential:'synthetic'}},r);
    const script=[...r.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    let destination='';const c={DevFitAuth:{startSession:async()=>({error})},location:{replace:v=>destination=v}};
    vm.runInNewContext(script,c);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(destination,'/login.html?auth='+(error==='account_store_unavailable'?'retry':error));
  }
});
test('late verification and premium replies cannot replace a different signed-in account',async()=>{
  for(const kind of ['verify','pro']){
    let complete;const h=client(()=>new Promise(resolve=>complete=resolve));
    const pending=kind==='verify'?h.c.DevFitAuth.reverify():h.c.DevFitAuth.requirePro();
    h.storage.set('devfit_user',JSON.stringify({email:'two@example.invalid',tier:'free'}));h.storage.set('devfit_token','two-token');
    complete(ok(kind==='verify'?{approved:true,email:payload.email,tier:'pro',token:'stale-one'}:{authorized:true,tier:'pro',token:'stale-one'}));
    await pending;assert.equal(h.c.DevFitAuth.getUser().email,'two@example.invalid');assert.equal(h.c.DevFitAuth.getToken(),'two-token');
  }
});
test('partial storage failure cannot report an approved login or replace previous identity',async()=>{
  const h=client(async()=>ok({approved:true,email:'two@example.invalid',token:'two-token',tier:'free'}));
  const set=h.c.localStorage.setItem;
  h.c.localStorage.setItem=(k,v)=>{if(k==='devfit_token')throw Error('QuotaExceeded');set(k,v);};
  const result=await h.c.DevFitAuth.startSession('google_id','synthetic','');
  assert.equal(result.error,'device_storage_unavailable');assert.equal(h.c.DevFitAuth.getUser().email,payload.email);
  assert.equal(h.c.DevFitAuth.getToken(),'old-token');
});
test('new PWA storage can restore a valid cookie session without a Google picker',async()=>{
  const h=client(async()=>ok({approved:true,email:payload.email,deviceId:device,token:'restored-token',tier:'free',browserContext:'c'.repeat(64)}),false);
  assert.equal(await h.c.DevFitAuth.restoreSession(),true);assert.equal(h.c.DevFitAuth.getUser().email,payload.email);
  assert.equal(h.storage.get('devfit_device_id'),device);assert.match(h.c.document.cookie,/__Host-devfit_active=/);
});
test('existing local account cannot be silently changed by an unrelated cookie',async()=>{
  const h=client(async()=>ok({approved:true,email:'two@example.invalid',deviceId:device,token:'two-token'}));
  assert.equal(await h.c.DevFitAuth.restoreSession(),false);assert.equal(h.c.DevFitAuth.getToken(),'old-token');
});
test('blocked cookies do not break a valid localStorage sign-in',async()=>{
  const h=client(async()=>ok({approved:true,email:payload.email,token:'fresh-token',tier:'free',browserContext:'c'.repeat(64)}));
  Object.defineProperty(h.c.document,'cookie',{set(){throw Error('SecurityError');}});
  const result=await h.c.DevFitAuth.startSession('google_id','synthetic','');
  assert.equal(result.approved,true);assert.equal(h.c.DevFitAuth.getToken(),'fresh-token');
});
test('rendered page retains its own local namespace after account switch',()=>{
  const h=client();h.c.localStorage.setItem('progressLog2','{"owner":"one"}');
  h.storage.set('devfit_user',JSON.stringify({email:'two@example.invalid'}));
  h.c.localStorage.setItem('progressLog2','{"owner":"late-one"}');
  assert.equal(h.storage.get('progressLog2::'+payload.email),'{"owner":"late-one"}');
  assert.equal(h.storage.get('progressLog2::two@example.invalid'),undefined);
  h.events.storage({key:'devfit_user',oldValue:JSON.stringify({email:payload.email}),newValue:JSON.stringify({email:'two@example.invalid'})});
  assert.equal(h.c.location.href,'index.html');
});
