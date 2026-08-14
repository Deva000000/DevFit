/* DevFit progress model v2
   Programs are immutable identities. Calendar weeks may overlap between programs,
   but their records never collide because sync merges by program id first.

   The page still consumes the legacy top-level arrays. They are a materialized
   view of the active program so reports and older backups remain compatible while
   program history is retained inside the same account-bound progress document.
*/
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 2;

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function blankWeek() { return Array(7).fill(''); }
  function blankCheckin() {
    return { overload:null, bf:'', bfDir:null, diet:null, stress:null, notes:'', meas:{waist:'',chest:'',arms:'',thighs:'',hips:''} };
  }
  function value(v, fallback) { return v === undefined || v === null ? fallback : v; }
  function positiveInt(v, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  function mondayYmd(input) {
    const d = input ? new Date(String(input).slice(0, 10) + 'T00:00:00') : new Date();
    if (isNaN(d)) return mondayYmd();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function weekDate(start, index) {
    const d = new Date(mondayYmd(start) + 'T00:00:00');
    d.setDate(d.getDate() + index * 7);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function newId() {
    try { if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID(); } catch (_) {}
    return 'program-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
  }
  function legacyId(start) { return 'legacy-' + mondayYmd(start || new Date()); }
  function normalizeRow(row) {
    const out = Array.isArray(row) ? row.slice(0, 7) : [];
    while (out.length < 7) out.push('');
    return out;
  }
  function normalizeCheckin(checkin) {
    const out = Object.assign(blankCheckin(), checkin && typeof checkin === 'object' ? clone(checkin) : {});
    out.meas = Object.assign(blankCheckin().meas, out.meas && typeof out.meas === 'object' ? out.meas : {});
    return out;
  }
  function normalizeProgram(program) {
    const p = Object.assign({}, program || {});
    p.id = String(p.id || newId());
    p.start = mondayYmd(p.start || p.programStart || new Date());
    p.duration = positiveInt(p.duration || p.programDuration, 8);
    p.createdAt = p.createdAt || new Date().toISOString();
    p.updatedAt = p.updatedAt || p.createdAt;
    const count = Math.max(
      p.duration,
      Array.isArray(p.bw) ? p.bw.length : 0,
      Array.isArray(p.steps) ? p.steps.length : 0,
      Array.isArray(p.sleep) ? p.sleep.length : 0,
      Array.isArray(p.weeklyCheckin) ? p.weeklyCheckin.length : 0,
      1
    );
    p.bw = Array.from({length:count}, (_,i)=>normalizeRow(p.bw && p.bw[i]));
    p.steps = Array.from({length:count}, (_,i)=>normalizeRow(p.steps && p.steps[i]));
    p.sleep = Array.from({length:count}, (_,i)=>normalizeRow(p.sleep && p.sleep[i]));
    p.weeklyCheckin = Array.from({length:count}, (_,i)=>normalizeCheckin(p.weeklyCheckin && p.weeklyCheckin[i]));
    return p;
  }
  function mergeCells(preferred, fallback) {
    const a = normalizeRow(preferred), b = normalizeRow(fallback);
    return a.map((v,i)=>(v === '' || v === null || v === undefined) ? b[i] : v);
  }
  function hasCheckinData(c) {
    if (!c || typeof c !== 'object') return false;
    if (c.overload || c.bf || c.bfDir || c.diet || c.stress || c.notes) return true;
    return c.meas && Object.keys(c.meas).some(k=>c.meas[k] !== '' && c.meas[k] != null);
  }
  function mergeCheckin(preferred, fallback) {
    const a = normalizeCheckin(preferred), b = normalizeCheckin(fallback);
    const out = Object.assign({}, b, a);
    Object.keys(out).forEach(k=>{ if ((out[k] === '' || out[k] == null) && b[k] !== '' && b[k] != null) out[k] = b[k]; });
    out.meas = Object.assign({}, b.meas || {}, a.meas || {});
    Object.keys(out.meas).forEach(k=>{ if ((out.meas[k] === '' || out.meas[k] == null) && b.meas && b.meas[k] !== '' && b.meas[k] != null) out.meas[k] = b.meas[k]; });
    return out;
  }
  function mergeProgram(preferred, fallback) {
    const a = normalizeProgram(preferred), b = normalizeProgram(fallback);
    const out = Object.assign({}, b, a);
    const count = Math.max(a.bw.length, b.bw.length, a.duration, b.duration);
    out.duration = positiveInt(a.duration, positiveInt(b.duration, count));
    out.bw=[]; out.steps=[]; out.sleep=[]; out.weeklyCheckin=[];
    for (let i=0;i<count;i++) {
      out.bw.push(mergeCells(a.bw[i], b.bw[i]));
      out.steps.push(mergeCells(a.steps[i], b.steps[i]));
      out.sleep.push(mergeCells(a.sleep[i], b.sleep[i]));
      out.weeklyCheckin.push(mergeCheckin(a.weeklyCheckin[i], b.weeklyCheckin[i]));
    }
    return normalizeProgram(out);
  }
  function timelineFromLegacy(doc) {
    const weeks = new Map();
    function collect(source) {
      if (!source || !source.programStart) return;
      const count = Math.max((source.bw||[]).length,(source.steps||[]).length,(source.sleep||[]).length,(source.weeklyCheckin||[]).length);
      for (let i=0;i<count;i++) {
        const key = weekDate(source.programStart, i), old = weeks.get(key) || {};
        weeks.set(key, {
          bw:mergeCells(source.bw && source.bw[i], old.bw),
          steps:mergeCells(source.steps && source.steps[i], old.steps),
          sleep:mergeCells(source.sleep && source.sleep[i], old.sleep),
          checkin:mergeCheckin(source.weeklyCheckin && source.weeklyCheckin[i], old.checkin)
        });
      }
    }
    collect(doc && doc._proHistory);
    collect(doc);
    const dates = Array.from(weeks.keys()).sort();
    const start = dates[0] || mondayYmd(doc && doc.programStart);
    const last = dates[dates.length-1] || start;
    const span = Math.max(1, Math.round((new Date(last+'T00:00:00')-new Date(start+'T00:00:00'))/(7*86400000))+1);
    const p = {
      id:legacyId(start), start:start, duration:Math.max(positiveInt(doc && doc.programDuration, 8), span),
      goal:value(doc && doc.goal,''), goalType:value(doc && doc.goalType,'loss'), startWeight:value(doc && doc.startWeight,''),
      targetSteps:value(doc && doc.targetSteps,''), targetSleep:value(doc && doc.targetSleep,''),
      createdAt:value(doc && doc.programCreatedAt, new Date().toISOString()), updatedAt:new Date().toISOString(),
      bw:[],steps:[],sleep:[],weeklyCheckin:[]
    };
    for(let i=0;i<p.duration;i++){
      const w=weeks.get(weekDate(start,i))||{};
      p.bw.push(normalizeRow(w.bw)); p.steps.push(normalizeRow(w.steps)); p.sleep.push(normalizeRow(w.sleep));
      p.weeklyCheckin.push(normalizeCheckin(w.checkin));
    }
    return normalizeProgram(p);
  }
  function applyActive(doc) {
    const programs = Array.isArray(doc.programs) ? doc.programs : [];
    let p = programs.find(x=>x && x.id === doc.activeProgramId);
    if (!p) { p = programs[programs.length-1]; if (p) doc.activeProgramId = p.id; }
    if (!p) return doc;
    p = normalizeProgram(p);
    const idx=programs.findIndex(x=>x && x.id===p.id); if(idx>=0) programs[idx]=p;
    doc.programId=p.id; doc.programStart=p.start; doc.programDuration=String(p.duration);
    ['goal','goalType','startWeight','targetSteps','targetSleep'].forEach(k=>{ doc[k]=value(p[k],doc[k]||''); });
    doc.bw=clone(p.bw); doc.steps=clone(p.steps); doc.sleep=clone(p.sleep); doc.weeklyCheckin=clone(p.weeklyCheckin);
    delete doc._proHistory; delete doc.freeWeekOf;
    return doc;
  }
  function ensureDocument(input) {
    const doc = input && typeof input === 'object' ? input : {};
    if (doc.progressSchema !== SCHEMA_VERSION || !Array.isArray(doc.programs) || !doc.programs.length) {
      const legacy = timelineFromLegacy(doc);
      doc.progressSchema=SCHEMA_VERSION;
      doc.programs=[legacy];
      doc.activeProgramId=legacy.id;
      doc.activeProgramChangedAt=doc.activeProgramChangedAt||new Date().toISOString();
    } else {
      doc.programs=doc.programs.map(normalizeProgram);
      if(!doc.programs.some(p=>p.id===doc.activeProgramId)) doc.activeProgramId=doc.programs[doc.programs.length-1].id;
    }
    return applyActive(doc);
  }
  function captureActive(input, stamp) {
    // Do not hydrate an already-v2 document here: callers have just edited its
    // compatibility arrays, and hydrating first would replace those fresh values
    // with the previous program snapshot before we can capture them.
    const doc=(input&&input.progressSchema===SCHEMA_VERSION&&Array.isArray(input.programs)&&input.programs.length)?input:ensureDocument(input);
    const i=doc.programs.findIndex(p=>p.id===doc.activeProgramId);
    if(i<0) return doc;
    const old=doc.programs[i];
    doc.programs[i]=normalizeProgram(Object.assign({},old,{
      start:mondayYmd(doc.programStart||old.start), duration:positiveInt(doc.programDuration,old.duration),
      goal:value(doc.goal,''), goalType:value(doc.goalType,'loss'), startWeight:value(doc.startWeight,''),
      targetSteps:value(doc.targetSteps,''), targetSleep:value(doc.targetSleep,''),
      bw:doc.bw,steps:doc.steps,sleep:doc.sleep,weeklyCheckin:doc.weeklyCheckin,
      updatedAt:stamp||new Date().toISOString()
    }));
    return applyActive(doc);
  }
  function ensureTimeline(input, requiredWeeks) {
    const doc=captureActive(input), i=doc.programs.findIndex(p=>p.id===doc.activeProgramId);
    const p=doc.programs[i], count=Math.max(positiveInt(requiredWeeks,1),positiveInt(p.duration,8),p.bw.length);
    while(p.bw.length<count){p.bw.push(blankWeek());p.steps.push(blankWeek());p.sleep.push(blankWeek());p.weeklyCheckin.push(blankCheckin());}
    return applyActive(doc);
  }
  function startProgram(input, options) {
    const doc=captureActive(input), now=new Date().toISOString();
    const old=doc.programs.find(p=>p.id===doc.activeProgramId); if(old&&!old.archivedAt) old.archivedAt=now;
    const o=options||{}, duration=positiveInt(o.duration,8), start=mondayYmd(o.start||new Date());
    const p=normalizeProgram({id:newId(),start:start,duration:duration,createdAt:now,updatedAt:now,
      goal:value(o.goal,doc.goal||''),goalType:value(o.goalType,doc.goalType||'loss'),startWeight:value(o.startWeight,doc.startWeight||''),
      targetSteps:value(o.targetSteps,doc.targetSteps||''),targetSleep:value(o.targetSleep,doc.targetSleep||''),
      bw:Array.from({length:duration},blankWeek),steps:Array.from({length:duration},blankWeek),sleep:Array.from({length:duration},blankWeek),weeklyCheckin:Array.from({length:duration},blankCheckin)});
    if(p.startWeight!=='') p.bw[0][0]=p.startWeight;
    doc.programs.push(p); doc.activeProgramId=p.id; doc.activeProgramChangedAt=now;
    return applyActive(doc);
  }
  function mergeDocuments(preferredInput, fallbackInput) {
    const preferred=ensureDocument(clone(preferredInput||{})), fallback=ensureDocument(clone(fallbackInput||{}));
    const preferredReset=Date.parse(preferred.resetAt||'')||0, fallbackReset=Date.parse(fallback.resetAt||'')||0;
    // Account reset is the one intentional destructive operation. A signed,
    // timestamped reset must beat an older offline copy instead of resurrecting
    // the very history the owner explicitly erased.
    if(preferredReset!==fallbackReset) return preferredReset>fallbackReset?preferred:fallback;
    captureActive(preferred); captureActive(fallback);
    const byId=new Map();
    fallback.programs.forEach(p=>byId.set(p.id,normalizeProgram(p)));
    preferred.programs.forEach(p=>byId.set(p.id,byId.has(p.id)?mergeProgram(p,byId.get(p.id)):normalizeProgram(p)));
    const out=Object.assign({},fallback,preferred);
    out.progressSchema=SCHEMA_VERSION; out.programs=Array.from(byId.values()).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    out.activeProgramId=preferred.activeProgramId;
    const active=out.programs.find(p=>p.id===out.activeProgramId);
    out.programs.forEach(p=>{ if(active&&p.id!==active.id&&!p.archivedAt&&String(p.createdAt)<=String(active.createdAt)) p.archivedAt=active.createdAt; });
    return applyActive(out);
  }
  function programHasData(program) {
    const p=normalizeProgram(program);
    return p.bw.some(r=>r.some(v=>v!==''&&v!=null)) || p.steps.some(r=>r.some(v=>v!==''&&v!=null)) || p.sleep.some(r=>r.some(v=>v!==''&&v!=null)) || p.weeklyCheckin.some(hasCheckinData);
  }

  global.DevFitProgress={
    version:SCHEMA_VERSION,ensureDocument,captureActive,ensureTimeline,startProgram,mergeDocuments,applyActive,
    mondayYmd,programHasData,_normalizeProgram:normalizeProgram
  };
})(typeof window!=='undefined'?window:globalThis);
