import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';

const code=fs.readFileSync(new URL('../devfit-db.js',import.meta.url),'utf8');
const copy=o=>JSON.parse(JSON.stringify(o));
const doc=()=>({sessions:[{id:'s',date:'2026-10-02',workoutId:'upper',mts:0,logs:[{exId:'e',name:'Row',sets:[{weight:40,reps:10}]}]}],
  _deleted:[],cycleArchive:[],planLibrary:[],plan:{name:'Saved program',notes:'historical '.repeat(500)}});
function response(data,status=200){return{status,ok:status===200,json:async()=>copy(data),headers:{get:()=>null}};}
function client(fetch, initial=doc(), shared=new Map()){
  const timers=new Map(); let now=Date.parse('2026-10-02T00:00:00Z'),id=0;
  shared.set('devfit_token','synthetic');shared.set('devfit_user',JSON.stringify({email:'test@example.invalid'}));
  if(!shared.has('devfitTrainingV1'))shared.set('devfitTrainingV1',JSON.stringify(initial));
  const storage={getItem:k=>shared.get(k)??null,setItem:(k,v)=>shared.set(k,String(v)),removeItem:k=>shared.delete(k)};
  // This harness owns a virtual clock. Native WebCrypto uses a real worker pool,
  // which can finish after advance() has already jumped past the debounce tick.
  // Keep the SHA-256 result real, but its completion on the microtask scheduler.
  // Browser integration checks separately exercise native asynchronous WebCrypto.
  const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(_algorithm,bytes)=>Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer}};
  const context={fetch,localStorage:storage,crypto,TextEncoder,Uint8Array,console:{warn(){}},Date:class extends Date{static now(){return now;}},
    document:{getElementById:()=>null,createElement:()=>({style:{},setAttribute(){}}),body:{appendChild(){}},addEventListener(){}},
    setTimeout:(cb,ms)=>{timers.set(++id,{at:now+ms,cb});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){}};
  context.window=context;vm.runInNewContext(code,context);
  async function drain(){for(let i=0;i<30;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));for(let i=0;i<30;i++)await Promise.resolve();}
  async function advance(ms){await drain();const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].cb();await drain();}now=end;await drain();}
  function edit(value){storage.setItem('devfitTrainingV1',JSON.stringify(value));return context.DevFitDB.cloudSave('workouts',value);}
  return{db:context.DevFitDB,storage,shared,advance,drain,edit};
}
function server(initial=doc()){
  let data=copy(initial),version='2026-10-02T00:00:00.000001+00:00';const calls=[];
  return{calls,get data(){return data;},get version(){return version;},
    async fetch(_url,options){const b=JSON.parse(options.body);calls.push(b);
      if(b.dataType==='prefs')return response({rows:[]});
      if(b.op==='get')return response({syncProtocol:2,rows:[{data_type:'workouts',updated_at:version,
        ...(b.knownVersions?.workouts===version?{notModified:true}:{data})}]});
      if(b.baseUpdatedAt!==version)return response({row:{data_type:'workouts',data,updated_at:version}},409);
      if(b.op==='set')data=copy(b.data);else for(const ch of b.changes){let parent=data;
        for(const key of ch.path.slice(0,-1))parent=parent[key];const key=ch.path.at(-1);
        if(ch.op==='remove'){if(Array.isArray(parent))parent.splice(Number(key),1);else delete parent[key];}else parent[key]=copy(ch.value);}
      version='2026-10-02T00:00:00.000'+String(calls.length+1).padStart(3,'0')+'+00:00';
      return response({ok:true,syncProtocol:2,updated_at:version});
    }};
}
async function sync(c){const p=c.db.cloudSync('workouts');await c.drain();await c.advance(850);await p;}
test('unchanged startup skips all uploads; one set edit sends a bounded field patch',async()=>{
  const s=server(),c=client(s.fetch);await sync(c);assert.equal(s.calls.filter(b=>b.op!=='get').length,0);
  const d=doc();d.sessions[0].logs[0].sets[0].reps=12;const p=c.edit(d);await c.advance(850);assert.equal(await p,true);
  const patch=s.calls.find(b=>b.op==='patch');assert.deepEqual(patch.changes,[{op:'set',path:['sessions','0','logs','0','sets','0','reps'],value:12}]);
  assert.ok(Buffer.byteLength(JSON.stringify(patch))<400);assert.equal(s.data.sessions[0].logs[0].sets[0].reps,12);
});
test('in-flight mutation cannot be acknowledged as if it had already been sent',async()=>{
  const s=server();let release;let first=true;
  const c=client(async(u,o)=>{const b=JSON.parse(o.body);if(b.op==='patch'&&first){first=false;await new Promise(r=>release=r);}return s.fetch(u,o);});
  await sync(c);const d=doc();d.sessions[0].logs[0].sets[0].reps=12;c.edit(d);await c.advance(850);
  d.sessions[0].logs[0].sets[0].reps=15;c.edit(d);release();await c.drain();await c.advance(850);
  assert.deepEqual(s.calls.filter(b=>b.op==='patch').map(b=>b.changes[0].value),[12,15]);assert.equal(s.data.sessions[0].logs[0].sets[0].reps,15);
});
test('committed save with lost response recovers through conflict without replaying an array append',async()=>{
  const s=server();let lost=true;
  const c=client(async(u,o)=>{const b=JSON.parse(o.body);const r=await s.fetch(u,o);if(b.op==='patch'&&lost){lost=false;throw Error('lost ACK');}return r;});
  await sync(c);const d=doc();d.sessions[0].logs[0].sets.push({weight:40,reps:8});const p=c.edit(d);await c.advance(850);assert.equal(await p,false);
  await c.advance(4000);assert.equal(s.data.sessions[0].logs[0].sets.length,2);assert.equal(JSON.parse(c.storage.getItem('devfit_sync_dirty')).workouts,undefined);
});
test('two devices merge distinct sessions after a stale patch conflict',async()=>{
  const s=server(),a=client(s.fetch),b=client(s.fetch);await sync(a);await sync(b);
  const first=doc();first.sessions.push({id:'b',date:'2026-10-01',workoutId:'lower',logs:[]});a.edit(first);await a.advance(850);
  const second=doc();second.sessions[0].logs[0].sets[0].reps=14;b.edit(second);await b.advance(850);
  assert.equal(s.data.sessions.length,2);assert.equal(s.data.sessions.find(x=>x.id==='s').logs[0].sets[0].reps,14);
});
test('acknowledged on-device hash allows a conditional read after page navigation',async()=>{
  const s=server(),a=client(s.fetch);await sync(a);await new Promise(r=>setTimeout(r,20));
  assert.ok(a.storage.getItem('devfit_sync_ack_v2'));
  const b=client(s.fetch,doc(),a.shared);await sync(b);assert.equal(s.calls.at(-1).knownVersions.workouts,s.version);
  assert.equal(s.calls.filter(b=>b.op!=='get').length,0);
});
test('dirty or changed local cache never claims it is the acknowledged server document',async()=>{
  const s=server(),a=client(s.fetch);await sync(a);await new Promise(r=>setTimeout(r,20));
  const edited=doc();edited.sessions[0].logs[0].sets[0].reps=20;a.storage.setItem('devfitTrainingV1',JSON.stringify(edited));
  const b=client(s.fetch,edited,a.shared);await sync(b);const get=s.calls.filter(b=>b.op==='get').at(-1);assert.equal(get.knownVersions,undefined);
});
test('failed initial reconciliation stays local and does not claim a successful force-sync',async()=>{
  let writes=0;const c=client(async(_u,o)=>{const b=JSON.parse(o.body);if(b.op!=='get')writes++;return response({},503);});
  const p=c.edit(doc());await c.advance(850);assert.equal(await p,false);assert.equal(writes,0);
  assert.equal((await c.db.forceSyncAll()).ok,false);assert.ok(JSON.parse(c.storage.getItem('devfit_sync_dirty')).workouts);
});

process.env.DEVFIT_JWT_SECRET='sync-tests-only';process.env.SUPABASE_SERVICE_KEY='sync-tests-only';
const {default:handler}=await import('../api/data.js');const {signToken}=await import('../api/_lib.js');
async function api(body){let status,result;await handler({method:'POST',headers:{},body:{token:signToken({email:'owner@example.invalid'}),...body}},
  {setHeader(){},status(s){status=s;return this;},json(r){result=r;}});return{status,result};}
test('patch contract rejects unsafe paths, invalid operations and excess payload before any DB access',async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not reach DB');};
  try{for(const changes of [[{op:'set',path:['__proto__','tier'],value:'pro'}],[{op:'set',path:[],value:{}}],
    [{op:'set',path:[1],value:1}],[{op:'merge',path:['tier'],value:'pro'}],[{op:'set',path:['x']}],Array(129).fill({op:'remove',path:['x']})]){
    assert.equal((await api({op:'patch',dataType:'workouts',changes})).status,400);}
    assert.equal((await api({op:'patch',dataType:'workouts',changes:[{op:'set',path:['x'],value:'a'.repeat(132000)}]})).status,413);assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});
test('conditional reads and patches derive identity only from signed account and use private named RPCs',async()=>{
  const old=globalThis.fetch,calls=[];globalThis.fetch=async(u,o)=>{calls.push({url:String(u),body:JSON.parse(o.body)});return{ok:true,json:async()=>({status:'ok',rows:[],updated_at:'v'})};};
  try{assert.equal((await api({op:'get',dataType:'workouts',email:'victim@example.invalid',knownVersions:{workouts:'v'}})).status,200);
    assert.equal((await api({op:'patch',dataType:'workouts',email:'victim@example.invalid',changes:[{op:'set',path:['x'],value:0}]})).status,200);
    assert.ok(calls[0].url.endsWith('/load_devfit_account_delta'));assert.ok(calls[1].url.endsWith('/patch_devfit_data_atomic'));
    assert.ok(calls.every(c=>c.body.p_email==='owner@example.invalid'));assert.equal(calls[1].body.p_security_context,null);
  }finally{globalThis.fetch=old;}
});
