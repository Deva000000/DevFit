import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const source=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');
const copy=o=>JSON.parse(JSON.stringify(o));
function context(){
  const events={},storage=new Map([['devfit_user',JSON.stringify({email:'qa@example.invalid'})]]);
  const c={console,Date,setTimeout:()=>1,clearTimeout(){},Promise,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    document:{addEventListener(){},getElementById:()=>null},addEventListener:(k,fn)=>events[k]=fn};
  c.window=c;vm.createContext(c);vm.runInContext(source('progress-model.js'),c);vm.runInContext(source('devfit-db.js'),c);
  return {c,storage,events};
}
function progress(c){return c.DevFitProgress.ensureDocument({programStart:'2026-07-13',programDuration:'12',startWeight:'70',bw:[['70']],steps:[],sleep:[],weeklyCheckin:[]});}
const day='2026-09-30';
const meal=(items=['a'])=>({id:'meal',name:'Breakfast',items:items.map(id=>({id,cal:100,p:10}))});
const nutrition=(items,mts=100)=>({targets:{cal:2000},days:{[day]:{meals:[meal(items)],mts}}});

test('capturing an unchanged program is stable and an ordinary edit cannot move its calendar',()=>{
  const {c}=context();const d=progress(c);const before=JSON.stringify(d);
  c.DevFitProgress.captureActive(d);assert.equal(JSON.stringify(d),before);
  d.programStart='2026-09-28';d.bw[0][1]='70.2';c.DevFitProgress.captureActive(d);
  assert.equal(d.programStart,'2026-07-13');assert.equal(d.bw[0][1],'70.2');
});
test('authoritative cloud dates defeat stale local anchors without discarding local weight edits',()=>{
  const {c}=context();const cloud=progress(c),local=copy(cloud);
  local.programStart=local.programs[0].start='2026-09-28';local.bw[0][1]='70.2';c.DevFitProgress.captureActive(local);
  const merged=c.DevFitProgress.mergeDocuments(local,cloud,cloud);
  assert.equal(merged.programStart,'2026-07-13');assert.equal(merged.bw[0][1],'70.2');
});
test('a cleared daily value defeats a stale filled value, independently of document preference',()=>{
  const {c}=context();const old=progress(c),cleared=copy(old);cleared.bw[0][0]='';c.DevFitProgress.captureActive(cleared);
  assert.equal(c.DevFitProgress.mergeDocuments(old,cleared).bw[0][0],'');
  assert.equal(c.DevFitProgress.mergeDocuments(cleared,old).bw[0][0],'');
});
test('a later intentional switch wins while a deliberately empty new program remains active',()=>{
  const {c}=context();const old=progress(c);old.activeProgramChangedAt='2026-07-13T00:00:00Z';
  const fresh=c.DevFitProgress.startProgram(copy(old),{start:'2026-09-28',duration:8,startWeight:''});
  assert.equal(c.DevFitProgress.mergeDocuments(old,fresh).activeProgramId,fresh.activeProgramId);
  assert.equal(c.DevFitProgress.mergeDocuments(fresh,old).activeProgramId,fresh.activeProgramId);
});
test('nutrition merges independent foods and never mutates either input',()=>{
  const {c}=context(),a=nutrition(['a']),b=nutrition(['b']);const before=JSON.stringify([a,b]);
  const out=c.DevFitDB._merge('nutrition',a,b);
  assert.deepEqual(copy(out.days[day].meals[0].items.map(i=>i.id)),['a','b']);
  assert.equal(JSON.stringify([a,b]),before);
});
test('fresh-device blank meal placeholders do not duplicate the restored food diary',()=>{
  const {c}=context();const placeholder={days:{[day]:{meals:[{id:'new-placeholder',name:'Breakfast',items:[]}]}}};
  assert.equal(c.DevFitDB._merge('nutrition',nutrition(['a']),placeholder).days[day].meals.length,1);
  assert.equal(c.DevFitDB._merge('nutrition',placeholder,nutrition(['a'])).days[day].meals.length,1);
});
test('cross-tab refresh listens only to the current account and keeps the live editor notified',async()=>{
  const {c,storage,events}=context();let received=0;
  await c.DevFitDB.cloudSync('workouts','devfitTrainingV1',()=>received++);
  storage.set('devfitTrainingV1',JSON.stringify({sessions:[]}));
  events.storage({key:'devfitTrainingV1::other@example.invalid'});assert.equal(received,0);
  events.storage({key:'devfitTrainingV1::qa@example.invalid'});assert.equal(received,1);
  events.storage({key:'devfitTrainingV1'});assert.equal(received,2);
});
test('deleted food, meal and cleared day cannot reappear from a stale richer device',()=>{
  const {c}=context(),stale=nutrition(['a','b']);
  const now=Date.now();const removed=nutrition(['b'],now);removed._deleted=[{k:day+'|meal:meal|item:a',ts:now}];
  assert.deepEqual(copy(c.DevFitDB._merge('nutrition',removed,stale).days[day].meals[0].items.map(i=>i.id)),['b']);
  const gone={days:{[day]:{meals:[],mts:now}},_deleted:[{k:day+'|meal:meal',ts:now}]};
  assert.equal(c.DevFitDB._merge('nutrition',gone,stale).days[day].meals.length,0);
  gone._deleted=[{k:'day|'+day,ts:now}];
  assert.equal(c.DevFitDB._merge('nutrition',stale,gone).days[day].meals.length,0);
});
test('replacing a diet day permits the new plan but never restores replaced foods',()=>{
  const {c}=context(),stale=nutrition(['a','b']);const now=Date.now();const fresh=nutrition(['new'],now+1);
  fresh._deleted=[{k:'day|'+day,ts:now}];
  assert.deepEqual(copy(c.DevFitDB._merge('nutrition',fresh,stale).days[day].meals[0].items.map(i=>i.id)),['new']);
  assert.match(source('nutrition.html'),/replacedAt\+1/);
});
test('legacy foods without stable IDs retain the chosen day instead of collapsing together',()=>{
  const {c}=context(),a=nutrition(['a']),b=nutrition(['b']);delete a.days[day].meals[0].items[0].id;
  assert.equal(c.DevFitDB._merge('nutrition',a,b).days[day].meals[0].items.length,1);
});
test('removed workout sets stay removed after a stale device merge',()=>{
  const {c}=context();const doc=(sets,ts)=>({sessions:[{date:day,workoutId:'upper',logs:[{name:'Row',setStructureAt:ts,sets}]}]});
  const old=doc([{reps:10},{reps:8},{reps:6}],0),fresh=doc([{reps:10}],Date.now());
  assert.equal(c.DevFitDB._merge('workouts',old,fresh).sessions[0].logs[0].sets.length,1);
  assert.match(source('workouts.html'),/log\.setStructureAt=Date\.now\(\)/);
});
test('starting or merging later mesocycles never silently truncates older workout history',()=>{
  const {c}=context();const archives=Array.from({length:12},(_,i)=>({id:'cycle-'+i,savedAt:i+1,sessions:[{date:day,workoutId:'w'+i}]}));
  assert.equal(c.DevFitDB._merge('workouts',{sessions:[],cycleArchive:archives.slice(0,6)},{sessions:[],cycleArchive:archives.slice(6)}).cycleArchive.length,12);
  assert.doesNotMatch(source('workouts.html'),/cycleArchive=arch\.slice\(0,/);
});
test('mesocycle transitions cannot rewrite shared progress dates and onboarding checks recovered data',()=>{
  assert.doesNotMatch(source('workouts.html'),/writeProgramStart|restartedWeeks:restartWeeks/);
  assert.match(source('index.html'),/function onbFinish\(\)\{[\s\S]*?if\(localHasProgress\(\)\)/);
});
test('database protection rejects re-anchoring at the atomic save boundary and keeps RPCs private',()=>{
  const sql=source('supabase/migrations/20261002200535_preserve_program_identity.sql');
  assert.match(sql,/not public\.devfit_progress_anchors_valid\(p_data,v_existing\.data\)/);
  assert.match(sql,/'program_dates_locked'/);assert.match(sql,/v_match->>'start' is distinct from v_program->>'start'/);
  assert.match(sql,/revoke all on function public\.devfit_progress_anchors_valid\(jsonb,jsonb\) from public,anon,authenticated/);
});
test('calendar weeks remain correct across global time zones and daylight-saving boundaries',()=>{
  for(const tz of ['Asia/Kuala_Lumpur','America/Los_Angeles','Europe/London','Pacific/Auckland']){
    const code=`const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync('progress-model.js','utf8'));const m=DevFitProgress;
      if(m.mondayYmd(new Date('2026-07-15T12:00:00'))!=='2026-07-13')throw Error('date object');
      if(m.calendarWeekIndex('2026-03-02','2026-03-09')!==1)throw Error('spring DST');
      if(m.calendarWeekIndex('2026-10-26','2026-11-02')!==1)throw Error('autumn DST');`;
    execFileSync(process.execPath,['-e',code],{cwd:new URL('../',import.meta.url),env:{...process.env,TZ:tz}});
  }
});
