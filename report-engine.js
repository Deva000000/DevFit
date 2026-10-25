/* DevFit — report engine
   ------------------------------------------------------------------
   Reads every logged source for a span of weeks and reduces it to numbers,
   trends, and ONE stat line per topic. Both PDF exports call in here — writing
   this twice is the app-vs-report drift scoring.js was created to kill.

   Design rule, learned the hard way: the report is a dashboard, not an essay.
   An earlier version wrote a coached paragraph under every chart (what
   happened / why it matters / verdict) and it was too much to read. What a
   client wants is the trend and a clean record of what they logged. Charts and
   tables carry the report; text is one line per section. Keep it that way.

   Contract: every function is null-safe. A half-logged week, a missing
   programStart, an empty food diary — all resolve to "nothing logged",
   never to a crash and never to an invented number.

   Thresholds below come from: rate of loss 0.5–1.0 %BW/wk (Helms 2014;
   Garthe 2011), lean gain 0.25–0.5 %BW/wk (Aragon & Schoenfeld 2013), protein
   1.6–2.2 g/kg (Morton 2018), steps plateau ~8,000/day (Paluch 2022), sleep
   7–9 h (Hirshkowitz 2015). They set the bands; the report no longer prints
   the reasoning.

   PDF SAFETY: text produced here is printed with jsPDF standard fonts
   (WinAnsi / cp1252). Stay inside that set — en/em dash, middle dot, times,
   plus-minus and degree are fine; arrows, bullets and >= are NOT.
*/
'use strict';

/* ================= shared date + storage helpers =================
   These used to be duplicated inline in settings.html. They live here now so
   the Usage panel, the week report and the program report all resolve a week
   to the same seven calendar days. */

// The host page declares `let appData = {...}` at script top level. A top-level
// `let` binds in the global LEXICAL scope, which is NOT the same thing as a
// property on `window` — `window.appData` is undefined there, and guarding with
// it silently reads an empty program (every weight, step and sleep row comes
// back null while the score, which reads the bare identifier, still works).
// Read the bare binding, defensively.
function AD(){
  try{ return (typeof appData !== 'undefined' && appData) ? appData : {}; }
  catch(e){ return {}; }
}

function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

function mondayOf(d){
  const dt=new Date(d); if(isNaN(dt)) return null;
  dt.setHours(0,0,0,0);
  const day=dt.getDay();
  dt.setDate(dt.getDate()+(day===0?-6:1-day));
  return dt;
}

// Unified anchor: appData.programStart > account startDate > null (unanchored).
function programStartDate(){
  let base=null;
  try{ const ad=AD(); if(ad.programStart){ const d=new Date(ad.programStart.slice(0,10)+'T00:00:00'); if(!isNaN(d)) base=d; } }catch(e){}
  if(!base){ try{ const u=JSON.parse(localStorage.getItem('devfit_user')||'{}'); if(u.startDate){ const d=new Date(u.startDate.slice(0,10)+'T00:00:00'); if(!isNaN(d)) base=d; } }catch(e){} }
  if(!base) return null;
  return mondayOf(base);
}

// Map a 0-indexed program week to its 7 calendar date strings (Mon -> Sun).
function weekDateStrings(w){
  const start=programStartDate();
  if(!start) return null;
  const out=[];
  for(let i=0;i<7;i++){ const d=new Date(start); d.setDate(start.getDate()+w*7+i); out.push(ymd(d)); }
  return out;
}

function weekRangeLabel(w){
  const ds=weekDateStrings(w); if(!ds) return '';
  const a=new Date(ds[0]+'T00:00:00'), b=new Date(ds[6]+'T00:00:00');
  const mo=d=>d.toLocaleDateString('en-US',{month:'short'});
  const sameM=a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear();
  return a.getDate()+(sameM?'':' '+mo(a))+'–'+b.getDate()+' '+mo(b);
}

function loadNutrition(){ try{ return JSON.parse(localStorage.getItem('devfitNutritionV2')||'null')||{targets:{},days:{}}; }catch(e){ return {targets:{},days:{}}; } }
function loadTraining(){
  try{
    const data=JSON.parse(localStorage.getItem('devfitTrainingV1')||'null')||{plan:{workouts:[]},sessions:[]};
    const sessions=new Map();
    (data.sessions||[]).concat((data.cycleArchive||[]).flatMap(a=>a.sessions||[])).forEach(s=>{
      const key=s.date+'|'+s.workoutId;if(!sessions.has(key))sessions.set(key,s);
    });
    data.sessions=Array.from(sessions.values());return data;
  }catch(e){return {plan:{workouts:[]},sessions:[]};}
}

function dayMacros(day){
  if(!day) return null;
  let cal=0,p=0,c=0,f=0,n=0;
  (day.meals||[]).forEach(m=>(m.items||[]).forEach(it=>{ cal+=Number(it.cal)||0; p+=Number(it.p)||0; c+=Number(it.c)||0; f+=Number(it.f)||0; n++; }));
  if(n===0) return null;
  return {cal:Math.round(cal),p:Math.round(p),c:Math.round(c),f:Math.round(f),items:n};
}

/* ============================ ENGINE ============================ */
var DevFitReport = (function(){

  const DLAB=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  /* ---------- tiny numeric helpers ---------- */
  function num(v){ if(v===''||v==null) return null; const x=Number(v); return isNaN(x)?null:x; }
  function mean(a){ const v=a.filter(x=>x!=null&&!isNaN(x)); return v.length?v.reduce((s,x)=>s+x,0)/v.length:null; }
  function r1(x){ return Math.round(x*10)/10; }
  function f1(x){ return (Math.round(x*10)/10).toFixed(1); }
  function pct(x){ return Math.round(x)+'%'; }
  function kcal(x){ return Math.round(x).toLocaleString(); }
  // Least-squares slope of y over x. Used for a trend that one bad weigh-in
  // can't flip, unlike first-vs-last.
  function slope(pts){
    const p=pts.filter(q=>q.y!=null);
    const n=p.length; if(n<2) return null;
    let sx=0,sy=0,sxx=0,sxy=0;
    p.forEach(q=>{ sx+=q.x; sy+=q.y; sxx+=q.x*q.x; sxy+=q.x*q.y; });
    const d=n*sxx-sx*sx; if(!d) return null;
    return (n*sxy-sx*sy)/d;
  }
  function sd(a){
    const v=a.filter(x=>x!=null&&!isNaN(x)); if(v.length<2) return null;
    const m=v.reduce((s,x)=>s+x,0)/v.length;
    return Math.sqrt(v.reduce((s,x)=>s+(x-m)*(x-m),0)/(v.length-1));
  }
  // Epley. The honest read on "did the lift get stronger" when reps and load
  // both move — 3x8 at 60 kg beats 3x5 at 65 kg, and only e1RM says so.
  function e1rm(weight,reps){
    const w=num(weight), r=num(reps);
    if(w==null||r==null||w<=0||r<=0) return null;
    return w*(1+r/30);
  }

  /* ---------- date formatting ---------- */
  function D(ds){ return new Date(ds+'T00:00:00'); }
  function fmtDay(ds){ const d=D(ds); return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
  function fmtFull(ds){ const d=D(ds); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
  function fmtSpan(a,b){
    const x=D(a), y=D(b);
    const sameY=x.getFullYear()===y.getFullYear();
    const sameM=sameY&&x.getMonth()===y.getMonth();
    const mo=d=>d.toLocaleDateString('en-GB',{month:'short'});
    if(sameM) return x.getDate()+'–'+y.getDate()+' '+mo(y)+' '+y.getFullYear();
    if(sameY) return x.getDate()+' '+mo(x)+' – '+y.getDate()+' '+mo(y)+' '+y.getFullYear();
    return fmtFull(a)+' – '+fmtFull(b);
  }

  /* ---------- who is this report for ---------- */
  function reportName(){
    try{
      const ad=AD(); if(ad.clientName && String(ad.clientName).trim()) return String(ad.clientName).trim();
      const u=JSON.parse(localStorage.getItem('devfit_user')||'{}');
      if(u.name && String(u.name).trim()) return String(u.name).trim();
      if(u.email) return u.email.split('@')[0];
    }catch(e){}
    return 'Athlete';
  }

  /* ---------- calendar-month presets ----------
     A week belongs to the month that contains its MONDAY. Weeks straddle month
     boundaries, so the report always prints the real date span underneath the
     month name rather than pretending the month and the block line up. */
  function monthPresets(totalWeeks){
    const start=programStartDate();
    if(!start) return [];
    const buckets={};
    for(let w=0;w<totalWeeks;w++){
      const d=new Date(start); d.setDate(start.getDate()+w*7);
      const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      if(!buckets[key]) buckets[key]={key, label:d.toLocaleDateString('en-GB',{month:'long',year:'numeric'}),
                                      file:d.toLocaleDateString('en-GB',{month:'long'})+'_'+d.getFullYear(), weeks:[]};
      buckets[key].weeks.push(w);
    }
    return Object.keys(buckets).sort().map(k=>{
      const b=buckets[k];
      return { key:'m:'+k, label:b.label, startW:b.weeks[0], endW:b.weeks[b.weeks.length-1],
               fileBase:b.file+'_Monthly_Report', kind:'month', title:b.label+' Report' };
    });
  }

  /* ================= ANALYSIS ================= */
  return { monthPresets, reportName, fmtDay, fmtFull, fmtSpan, DLAB, f1 };
})();
