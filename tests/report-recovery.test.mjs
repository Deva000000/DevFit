import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fn(html,name){
  const at=html.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(at>=0,'missing '+name);
  const end=html.indexOf('\n}',at);
  return html.slice(at,end+2);
}
function fixture(){
  const grid=()=>Array.from({length:12},()=>Array(7).fill(''));
  const bw=grid(); bw[0][0]='70'; bw[11][0]='72';
  return {programStart:'2026-07-13',programDuration:'12',startWeight:'70',goal:'75',goalType:'gain',targetSteps:'8000',bw,steps:grid(),sleep:grid(),weeklyCheckin:Array.from({length:12},()=>({}))};
}
function context(){
  const storage=new Map(),nodes=new Map();
  const node=()=>({value:'',textContent:'',disabled:false,children:[],appendChild(v){this.children.push(v);},set innerHTML(v){this.children=[];this.html=v;},get innerHTML(){return this.html||'';}});
  for(const id of ['report-program','program-report-range','report-range-summary','week-report-title','week-report-desc','report-history-status','week-report-btn','program-report-btn']) nodes.set(id,node());
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-02T12:00:00']));}static now(){return new Date('2026-10-02T12:00:00').getTime();}}
  const c={console,Date:Clock,setTimeout,clearTimeout,Promise,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},document:{getElementById:k=>nodes.get(k)||null,createElement:node,activeElement:null},toast:()=>{},paintUsage:()=>{}};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(source('progress-model.js'),c);
  return {c,storage,nodes,node};
}
function settingsContext(){
  const state=context(),c=state.c,html=source('settings.html');
  vm.runInContext('var appData={bw:[],steps:[],sleep:[],weeklyCheckin:[]},totalWeeks=4,currentWeek=0,REPORT_RANGES=[],reportSelectionKey=null,reportProgramId=null,reportHistoryPending=null,reportHistoryCheckedAt=0;',c);
  vm.runInContext(source('scoring.js'),c);
  vm.runInContext(source('report-engine.js'),c);
  for(const name of ['loadReportData','reportRangeKey','reportableEndWeek','updateReportRangeSummary','buildReportProgramOptions','buildRangeOptions','reportHistoryStatus','refreshReportHistory','exportProgramPDF','exportWeekPDF','saveClientName']) vm.runInContext(fn(html,name),c);
  return state;
}

test('daily saves never copy stale setup values into a recovered program',()=>{
  const {c,storage,nodes,node}=context(),html=source('index.html');
  c.appData=c.DevFitProgress.ensureDocument(fixture());c.loadFailed=false;c.saveWarned=false;
  c.DevFitDB={cloudSave:(_,data)=>{c.pushed=JSON.parse(JSON.stringify(data));}};
  for(const [id,value] of Object.entries({programStart:'2026-09-28',programDuration:'8',startWeight:'',goalInput:'',targetSteps:''})){const el=node();el.value=value;nodes.set(id,el);}
  vm.runInContext(fn(html,'save'),c);
  c.appData.bw[11][1]='72.1'; c.save();
  const saved=JSON.parse(storage.get('progressLog2'));
  assert.equal(saved.programStart,'2026-07-13');
  assert.equal(saved.programDuration,'12');assert.equal(saved.goal,'75');assert.equal(saved.startWeight,'70');
  assert.equal(saved.programs[0].start,'2026-07-13');assert.equal(c.pushed.programStart,'2026-07-13');
  assert.equal(saved.bw[11][1],'72.1');
  c.ymd=d=>d.toISOString().slice(0,10);c.programStartDate=()=>new Date('2026-07-13');
  vm.runInContext(fn(html,'populateProgramInputs')+'\n'+fn(html,'saveProgramField'),c);
  c.populateProgramInputs();assert.equal(nodes.get('programStart').value,'2026-07-13');
  nodes.get('targetSteps').id='targetSteps';nodes.get('targetSteps').value='10000';
  c.saveProgramField(nodes.get('targetSteps'));assert.equal(c.pushed.targetSteps,'10000');
  assert.equal(c.pushed.programStart,'2026-07-13');
  for(const name of ['applyRestoredProgress','runProgressSync']) assert.match(fn(html,name),/populateProgramInputs\(\)/);
});

test('fresh Settings restores all report sources before choosing or generating a full report',async()=>{
  const {c,storage,nodes}=settingsContext();let calls=0;
  c.DevFitDB={restoreAccount:async()=>{
    calls++; await Promise.resolve();
    storage.set('progressLog2',JSON.stringify(fixture()));
    storage.set('devfitTrainingV1',JSON.stringify({sessions:[{date:'2026-09-30'}]}));
    storage.set('devfitNutritionV2',JSON.stringify({days:{'2026-10-01':{meals:[]}}}));
    return {ok:true,hasData:true};
  }};
  const results=await Promise.all([c.refreshReportHistory(true),c.refreshReportHistory(true)]);
  assert.deepEqual(results,[true,true]);assert.equal(calls,1);
  assert.equal(c.REPORT_RANGES[0].endW,11);assert.equal(c.REPORT_RANGES[0].startW,0);
  assert.match(nodes.get('report-range-summary').innerHTML,/Weeks 1–12/);
  let generated;c.generateReport=async range=>{generated=range;};
  await c.exportProgramPDF();assert.equal(calls,2);assert.equal(generated.endW,11);
  assert.equal(JSON.parse(storage.get('devfitTrainingV1')).sessions.length,1);
  assert.equal(nodes.get('program-report-btn').disabled,false);
});

test('report refresh preserves an explicitly chosen recent or individual period',async()=>{
  const {c,storage,nodes}=settingsContext();storage.set('progressLog2',JSON.stringify(fixture()));c.loadReportData();c.buildRangeOptions();
  const sel=nodes.get('program-report-range');
  sel.value=String(c.REPORT_RANGES.findIndex(r=>r.endW-r.startW===3));sel.onchange();
  c.DevFitDB={restoreAccount:async()=>({ok:true})};await c.refreshReportHistory(true);
  assert.equal(c.REPORT_RANGES[+sel.value].startW,8);
  sel.value=String(c.REPORT_RANGES.findIndex(r=>r.kind==='week'&&r.startW===2));sel.onchange();
  await c.refreshReportHistory(true);assert.equal(c.REPORT_RANGES[+sel.value].startW,2);
});

test('an unavailable or malformed account check cannot produce a partial report; retry works',async()=>{
  const {c,storage,nodes}=settingsContext();let ok=false,generated=0;
  c.DevFitDB={restoreAccount:async()=>({ok})};c.generateReport=async()=>{generated++;};
  await c.exportProgramPDF();assert.equal(generated,0);
  assert.match(nodes.get('report-history-status').textContent,/Nothing was deleted/);
  assert.equal(c.reportHistoryPending,null);assert.equal(nodes.get('program-report-btn').disabled,false);
  ok=true;storage.set('progressLog2','{broken');await c.exportProgramPDF();assert.equal(generated,0);
  storage.set('progressLog2',JSON.stringify(fixture()));await c.exportProgramPDF();assert.equal(generated,1);
});

test('new programs hide future weeks; training-only and sleep-only logging select the latest recorded week',()=>{
  const {c,storage}=settingsContext();const data=fixture();data.bw=data.bw.map(()=>Array(7).fill(''));data.programStart='2026-09-28';
  storage.set('progressLog2',JSON.stringify(data));c.loadReportData();c.buildRangeOptions();assert.equal(c.REPORT_RANGES.length,1);assert.equal(c.REPORT_RANGES[0].endW,0);
  data.programStart='2026-07-13';data.sleep[9][0]='7';storage.set('progressLog2',JSON.stringify(data));
  c.loadReportData();assert.equal(c.currentWeek,9);
  storage.set('devfitTrainingV1',JSON.stringify({sessions:[{date:'2026-09-30'},{date:'2027-01-01'}]}));
  c.loadReportData();assert.equal(c.currentWeek,11);
});

test('a Settings profile edit preserves newer local program metadata',()=>{
  const {c,storage,nodes,node}=settingsContext();const old=fixture();storage.set('progressLog2',JSON.stringify(old));c.loadReportData();
  const fresh=c.DevFitProgress.startProgram(old,{start:'2026-09-28',duration:8,startWeight:'72',goal:'75',goalType:'gain'});
  storage.set('progressLog2',JSON.stringify(fresh));const el=node();el.value='Synthetic User';nodes.set('clientNameInput',el);
  c.DevFitDB={cloudSave:()=>{}};c.saveClientName();
  const saved=JSON.parse(storage.get('progressLog2'));assert.equal(saved.activeProgramId,fresh.activeProgramId);assert.equal(saved.programStart,'2026-09-28');assert.equal(saved.programs.length,2);
});

test('archived program reports stay selected after recovery without changing the active program',async()=>{
  const {c,storage,nodes,node}=settingsContext();
  const old=c.DevFitProgress.ensureDocument(fixture());const archivedId=old.activeProgramId;
  const fresh=c.DevFitProgress.startProgram(old,{start:'2026-09-28',duration:16,startWeight:'72'});
  storage.set('progressLog2',JSON.stringify(fresh));c.loadReportData();c.buildRangeOptions();
  const sel=nodes.get('report-program');assert.equal(sel.children.length,2);
  sel.value=archivedId;sel.onchange();assert.equal(c.appData.programStart,'2026-07-13');
  assert.equal(c.REPORT_RANGES[0].endW,11);
  c.DevFitDB={restoreAccount:async()=>({ok:true}),cloudSave:(_,doc)=>assert.equal(doc.activeProgramId,fresh.activeProgramId)};
  await c.refreshReportHistory(true);assert.equal(sel.value,archivedId);
  const name=node();name.value='Updated name';nodes.set('clientNameInput',name);c.saveClientName();
  const saved=JSON.parse(storage.get('progressLog2'));
  assert.equal(saved.activeProgramId,fresh.activeProgramId);assert.equal(saved.programStart,'2026-09-28');
  assert.equal(saved.clientName,'Updated name');assert.equal(c.appData.activeProgramId,archivedId);
});

test('report training includes archived cycles once and prefers the live version',()=>{
  const {c,storage}=settingsContext();
  storage.set('devfitTrainingV1',JSON.stringify({sessions:[{id:'live',date:'2026-08-01',workoutId:'upper',notes:'latest'}],
    cycleArchive:[{sessions:[{id:'old',date:'2026-08-01',workoutId:'upper',notes:'old'},{id:'archived',date:'2026-07-20',workoutId:'lower'}]}]}));
  const train=c.loadTraining();assert.equal(train.sessions.length,2);assert.equal(train.sessions[0].notes,'latest');
});
