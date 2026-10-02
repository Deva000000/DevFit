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
  const context={fetch,localStorage:storage,console:{warn(){}},Date:FakeDate,JSON,Object,Array,Map,Math,Number,String,Promise,
    document:{getElementById:()=>null,createElement:()=>({style:{},setAttribute(){}}),body:{appendChild(){}},addEventListener(){}},
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
  return{advance,edit,storage,sharedStorage,drain};
}
const ok = data => ({status:200,ok:true,json:async()=>data});

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
