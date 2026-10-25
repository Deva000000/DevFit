import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../devfit-db.js',import.meta.url),'utf8');
function client(fetch, sharedStorage = new Map()) {
  const timers=new Map();let now=Date.parse('2026-10-02T00:00:00Z'),id=0;
  const FakeDate=class extends Date { static now(){return now;} };
  sharedStorage.set('devfit_token','synthetic-token');
  const storage={getItem:k=>sharedStorage.get(k)??null,setItem:(k,v)=>sharedStorage.set(k,String(v)),removeItem:k=>sharedStorage.delete(k)};
  const elements=new Map();
  const context={fetch,localStorage:storage,console:{warn(){}},Date:FakeDate,JSON,Object,Array,Map,Math,Number,String,Promise,
    document:{getElementById:id=>elements.get(id)||null,createElement:()=>({style:{},setAttribute(){}}),body:{appendChild(el){elements.set(el.id,el);}},addEventListener(){}},
    setTimeout:(cb,ms)=>{timers.set(++id,{at:now+ms,cb});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){}};
  context.window=context;vm.runInNewContext(code,context);
  const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  async function advance(ms){const end=now+ms;await drain();
    for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].cb();await drain();}
    now=end;await drain();
  }
  function edit(reps){const data={sessions:[{id:'s',date:'2026-10-02',workoutId:'upper',logs:[{exId:'e',name:'Row',sets:[{weight:40,reps}]}]}]};
    storage.setItem('devfitTrainingV1',JSON.stringify(data));return context.DevFitDB.cloudSave('workouts',data);}
  return{advance,edit,storage,sharedStorage,drain,elements,db:context.DevFitDB};
}
const ok = data => ({status:200,ok:true,json:async()=>data});

test('healthy page sync and edits create no floating save message',async()=>{
  const c=client(async(_url,options)=>JSON.parse(options.body).op==='get'?ok({rows:[]}):ok({ok:true}));
  const initial=c.db.cloudSync('workouts');await c.drain();await c.advance(850);await initial;
  const save=c.edit(12);await c.advance(850);assert.equal(await save,true);
  await c.advance(5000);
  assert.equal(c.elements.size,0,'no healthy status element, animation or live-region announcements');
});

test('sync warnings survive unrelated successes and disappear only after recovery',()=>{
  const c=client(async()=>ok({}));
  c.db.setIndicator('err','workouts');const el=c.elements.get('devfit-save-state');
  assert.equal(el.style.opacity,'1');assert.match(el.textContent,/delayed/);
  c.db.setIndicator('ok','prefs');c.db.setIndicator('device','workouts');c.db.setIndicator('syncing','workouts');
  assert.equal(el.style.opacity,'1','pending workout warning stays visible');
  c.db.setIndicator('offline','nutrition');c.db.setIndicator('ok','workouts');
  assert.match(el.textContent,/Offline/);
  c.db.setIndicator('ok','nutrition');assert.equal(el.textContent,'');assert.equal(el.style.opacity,'0');
});

test('an unchanged startup does not manufacture a local edit or queue a debounce',async()=>{
  const data={sessions:[],plan:{name:'Same'},_deleted:[],cycleArchive:[],planLibrary:[]};let writes=0;
  const c=client(async(_url,options)=>{
    if(JSON.parse(options.body).op==='get')return ok({rows:[{data_type:'workouts',data:{...data,plan:{name:'Same'}},updated_at:'2026-10-02T00:00:00Z'}]});
    writes++;return ok({ok:true});
  });
  c.storage.setItem('devfitTrainingV1',JSON.stringify(data));
  await c.db.cloudSync('workouts');
  assert.equal(c.storage.getItem('devfit_local_ts_workouts'),null);
  assert.equal(c.storage.getItem('devfit_sync_dirty'),null);
  assert.equal(writes,0);
});

test('JSONB key reordering during a page load is not a user edit',async()=>{
  const local={sessions:[],plan:{name:'Same'},_deleted:[],cycleArchive:[],planLibrary:[]};
  const remote={_deleted:[],cycleArchive:[],plan:{name:'Same'},planLibrary:[],sessions:[]};
  const c=client(async()=>ok({rows:[{data_type:'workouts',data:remote,updated_at:'2026-10-02T00:00:00Z'}]}));
  c.storage.setItem('devfitTrainingV1',JSON.stringify(local));
  await c.db.cloudSync('workouts');
  assert.equal(c.storage.getItem('devfit_local_ts_workouts'),null);
  assert.equal(c.storage.getItem('devfit_sync_dirty'),null);
});

test('server Retry-After persists through new edits and background resume',async()=>{
  let writes=0;const values=[];
  const c=client(async(_url,options)=>{const b=JSON.parse(options.body);
    if(b.op==='get')return ok({rows:[]});
    if(b.dataType==='prefs')return ok({ok:true});
    writes++;values.push(b.data.sessions[0].logs[0].sets[0].reps);
    if(writes===1)return{status:429,ok:false,headers:{get:()=> '300'},json:async()=>({retryAfter:300})};
    return ok({ok:true,updated_at:'2026-10-02T01:00:00Z'});
  });
  const p=c.edit(10);await c.advance(850);assert.equal(await p,false);assert.equal(writes,1);
  c.edit(12);await c.advance(60000);assert.equal(writes,1,'no retry at the old 60s cap');
  assert.ok(JSON.parse(c.storage.getItem('devfit_sync_dirty')).workouts);
  await c.advance(242000);assert.equal(writes,2);assert.deepEqual(values,[10,12]);
});

test('failed in-flight save retains newer pending edit even when local storage is stale',async()=>{
  let release,writes=0;const values=[];
  const c=client(async(_url,options)=>{const b=JSON.parse(options.body);
    if(b.op==='get')return ok({rows:[]});
    if(b.dataType==='prefs')return ok({ok:true});
    writes++;values.push(b.data.sessions[0].logs[0].sets[0].reps);
    if(writes===1){await new Promise(resolve=>{release=resolve;});throw Error('network down');}
    return ok({ok:true,updated_at:'2026-10-02T01:00:00Z'});
  });
  c.edit(10);await c.advance(850);assert.equal(writes,1);
  c.edit(15);
  // A quota-limited on-device write can leave the earlier persisted document.
  const old=JSON.parse(c.storage.getItem('devfitTrainingV1'));old.sessions[0].logs[0].sets[0].reps=10;
  c.storage.setItem('devfitTrainingV1',JSON.stringify(old));
  release();await c.drain();await c.advance(4000);
  assert.deepEqual(values,[10,15],'failed save must not replace the newer in-memory edit');
});

test('reopening restores failed save from durable device data',async()=>{
  let saved;
  const first=client(async(_url,options)=>{const b=JSON.parse(options.body);
    if(b.op==='get')return ok({rows:[]});throw Error('offline');});
  first.edit(18);await first.advance(850);
  assert.ok(JSON.parse(first.storage.getItem('devfit_sync_dirty')).workouts);
  const reopened=client(async(_url,options)=>{const b=JSON.parse(options.body);
    if(b.op==='get')return ok({rows:[]});
    if(b.dataType==='workouts')saved=b.data;
    return ok({ok:true,updated_at:'2026-10-02T01:00:00Z'});
  },first.sharedStorage);
  await reopened.advance(5000);
  assert.equal(saved.sessions[0].logs[0].sets[0].reps,18);
  assert.equal(JSON.parse(reopened.storage.getItem('devfit_sync_dirty')).workouts,undefined);
});
