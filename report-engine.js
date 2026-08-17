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
  try{ const ad=AD(); if(ad.programStart){ const d=new Date(ad.programStart); if(!isNaN(d)) base=d; } }catch(e){}
  if(!base){ try{ const u=JSON.parse(localStorage.getItem('devfit_user')||'{}'); if(u.startDate){ const d=new Date(u.startDate); if(!isNaN(d)) base=d; } }catch(e){} }
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
function loadTraining(){ try{ return JSON.parse(localStorage.getItem('devfitTrainingV1')||'null')||{plan:{workouts:[]},sessions:[]}; }catch(e){ return {plan:{workouts:[]},sessions:[]}; } }

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
  function analyze(startW, endW, opts){
    opts=opts||{};
    const A={};
    const ad=AD();
    const gt=ad.goalType||'loss';
    const nut=loadNutrition(), train=loadTraining();

    /* --- meta --- */
    const dsFirst=weekDateStrings(startW), dsLast=weekDateStrings(endW);
    const anchored=!!(dsFirst&&dsLast);
    const weeks=endW-startW+1;
    A.meta={
      name: reportName(),
      startW, endW, weeks, anchored,
      single: startW===endW,
      goalType: gt,
      goalLabel: gt==='loss'?'Fat loss':gt==='gain'?'Muscle gain':'Maintain',
      targetWeight: ad.goal?num(ad.goal):null,
      startWeight: ad.startWeight?num(ad.startWeight):null,
      programDuration: num(ad.programDuration)||null,
      startDate: anchored?dsFirst[0]:null,
      endDate: anchored?dsLast[6]:null,
      span: anchored?fmtSpan(dsFirst[0],dsLast[6]):'',
      calendarDays: weeks*7,
      generated: new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})
    };
    A.meta.title = opts.title || (A.meta.single ? ('Week '+(startW+1)+' Report') : ('Week '+(startW+1)+' to Week '+(endW+1)+' Report'));
    A.meta.fileBase = opts.fileBase || (A.meta.single ? ('Week_'+(startW+1)+'_Report') : ('Week'+(startW+1)+'_to_Week'+(endW+1)+'_Report'));
    A.meta.kind = opts.kind || (A.meta.single?'week':'range');

    /* --- per-week rows: the spine every section reads from --- */
    const rows=[];
    for(let w=startW;w<=endW;w++){
      const dates=weekDateStrings(w);
      const bwArr=(ad.bw||[])[w]||[];
      const stArr=(ad.steps||[])[w]||[];
      const slArr=(ad.sleep||[])[w]||[];
      const ci=(ad.weeklyCheckin||[])[w]||{overload:null,bf:'',bfDir:null,diet:null,stress:null,notes:''};
      let sc={overall:null,scores:{}};
      try{ sc=calcTrueScore(w); }catch(e){}

      // daily rows — the "talk about every day" layer
      const days=[];
      for(let d=0;d<7;d++){
        const ds=dates?dates[d]:null;
        const mac=ds?dayMacros(nut.days&&nut.days[ds]):null;
        const sess=ds?(train.sessions||[]).filter(s=>s.date===ds):[];
        days.push({
          idx:d, label:DLAB[d], date:ds,
          bw:num(bwArr[d]), steps:num(stArr[d]), sleep:num(slArr[d]),
          food:mac, sessions:sess
        });
      }
      rows.push({
        w, n:w+1, dates, days, ci,
        range: dates?fmtSpan(dates[0],dates[6]):'',
        score: sc.overall, scores: sc.scores,
        bwAvg: mean(days.map(x=>x.bw)),
        stepsAvg: mean(days.map(x=>x.steps)),
        sleepAvg: mean(days.map(x=>x.sleep)),
        bwDays: days.filter(x=>x.bw!=null).length,
        stepsDays: days.filter(x=>x.steps!=null).length,
        sleepDays: days.filter(x=>x.sleep!=null).length
      });
    }
    A.rows=rows;

    const allDays=[]; rows.forEach(r=>r.days.forEach(d=>allDays.push(d)));
    A.days=allDays;

    /* --- score --- */
    const scored=rows.filter(r=>r.score!=null);
    const avgScore=scored.length?Math.round(mean(scored.map(r=>r.score))):null;
    const best=scored.length?scored.reduce((a,b)=>b.score>a.score?b:a):null;
    const worst=scored.length?scored.reduce((a,b)=>b.score<a.score?b:a):null;
    const half=Math.floor(scored.length/2);
    const firstHalf=half?mean(scored.slice(0,half).map(r=>r.score)):null;
    const lastHalf=half?mean(scored.slice(scored.length-half).map(r=>r.score)):null;
    A.score={
      avg:avgScore, best, worst, weeksScored:scored.length,
      consistency: scored.length?Math.round(scored.filter(r=>r.score>=65).length/scored.length*100):null,
      firstHalf:firstHalf==null?null:Math.round(firstHalf),
      lastHalf:lastHalf==null?null:Math.round(lastHalf),
      drift: (firstHalf!=null&&lastHalf!=null)?Math.round(lastHalf-firstHalf):null,
      grade: avgScore==null?null:(avgScore>=85?'Excellent':avgScore>=65?'Good':avgScore>=40?'Fair':'Needs Work')
    };

    /* --- signal averages across the range (what is carrying / dragging) --- */
    const sigAgg={};
    rows.forEach(r=>Object.keys(r.scores||{}).forEach(k=>{
      const s=r.scores[k]; if(!s||s.val==null) return;
      if(!sigAgg[k]) sigAgg[k]={key:k,label:s.label,weight:s.weight,vals:[]};
      sigAgg[k].vals.push(s.val);
    }));
    A.signals=Object.keys(sigAgg).map(k=>{
      const s=sigAgg[k];
      const avg=Math.round(mean(s.vals));
      // "Lever" = the points still on the table. A signal scoring 40 % at weight
      // 23 is worth 13.8 points; one scoring 40 % at weight 8 is worth 4.8. The
      // lowest score is NOT automatically the biggest opportunity, and telling a
      // client to chase it would be advice that cannot pay off.
      return {key:k,label:s.label,weight:s.weight,avg,weeks:s.vals.length,
              lever:r1((100-avg)*s.weight/100)};
    }).sort((a,b)=>a.avg-b.avg);
    A.levers=A.signals.slice().sort((a,b)=>b.lever-a.lever);
    A.weakest=A.levers.slice(0,3);
    A.strongest=A.signals.slice().reverse().slice(0,2);

    /* --- bodyweight --- */
    const bwPts=rows.map((r,i)=>({x:i,y:r.bwAvg})).filter(p=>p.y!=null);
    const wkSlope=slope(bwPts);
    const firstBw=bwPts.length?bwPts[0].y:null;
    const lastBw=bwPts.length?bwPts[bwPts.length-1].y:null;
    const change=(firstBw!=null&&lastBw!=null&&bwPts.length>=2)?lastBw-firstBw:null;
    const ratePctWk=(wkSlope!=null&&lastBw)?(wkSlope/lastBw*100):null;
    // Plateau = the last three logged weekly averages sit inside a 0.4 % band.
    let plateau=false, plateauWeeks=0;
    if(bwPts.length>=3){
      const tail=bwPts.slice(-3).map(p=>p.y);
      const spread=Math.max.apply(null,tail)-Math.min.apply(null,tail);
      if(lastBw && (spread/lastBw*100)<0.4){ plateau=true; plateauWeeks=3; }
    }
    const dailyBw=allDays.filter(d=>d.bw!=null);
    A.weight={
      first:firstBw, last:lastBw, change,
      pctChange:(change!=null&&firstBw)?(change/firstBw*100):null,
      ratePerWeek:wkSlope, ratePctWk,
      daysLogged:dailyBw.length,
      coverage: Math.round(dailyBw.length/(weeks*7)*100),
      lowest: dailyBw.length?dailyBw.reduce((a,b)=>b.bw<a.bw?b:a):null,
      highest: dailyBw.length?dailyBw.reduce((a,b)=>b.bw>a.bw?b:a):null,
      plateau, plateauWeeks,
      target:A.meta.targetWeight,
      toTarget:(A.meta.targetWeight!=null&&lastBw!=null)?r1(lastBw-A.meta.targetWeight):null,
      etaWeeks:null, etaDate:null, band:null
    };
    // Projection — only when the trend is actually moving the right way.
    if(A.weight.target!=null && lastBw!=null && wkSlope!=null && Math.abs(wkSlope)>0.02){
      const gap=A.weight.target-lastBw;
      if((gap<0&&wkSlope<0)||(gap>0&&wkSlope>0)){
        const wk=Math.ceil(Math.abs(gap/wkSlope));
        if(wk>0&&wk<200){
          A.weight.etaWeeks=wk;
          if(anchored){ const d=D(dsLast[6]); d.setDate(d.getDate()+wk*7); A.weight.etaDate=fmtFull(ymd(d)); }
        }
      }
    }
    // Band verdict against the evidence-based rate for the stated goal.
    if(ratePctWk!=null){
      const p=ratePctWk;
      if(gt==='loss'){
        A.weight.band = p<=-1.0?'fast' : (p<=-0.5?'ideal' : (p<-0.15?'slow' : (p<=0.15?'flat':'wrong')));
      } else if(gt==='gain'){
        A.weight.band = p>=1.0?'fast' : (p>=0.25?'ideal' : (p>0.05?'slow' : (p>=-0.15?'flat':'wrong')));
      } else {
        A.weight.band = Math.abs(p)<=0.5?'ideal' : (Math.abs(p)<=1.0?'slow':'wrong');
      }
    }
    // Body fat check-in readings, first and last non-empty.
    const bfVals=rows.map(r=>({w:r.n,v:num(r.ci.bf),dir:r.ci.bfDir})).filter(x=>x.v!=null);
    A.weight.bfFirst=bfVals.length?bfVals[0]:null;
    A.weight.bfLast=bfVals.length?bfVals[bfVals.length-1]:null;
    A.weight.bfChange=(bfVals.length>=2)?r1(bfVals[bfVals.length-1].v-bfVals[0].v):null;

    /* --- training --- */
    const planMap={};
    ((train.plan&&train.plan.workouts)||[]).forEach(wo=>{
      planMap[wo.id]={name:wo.name||'Workout',ex:{}};
      (wo.exercises||[]).forEach(ex=>{ planMap[wo.id].ex[ex.id]=ex.name||'Exercise'; });
    });
    // Sessions are matched to the report by DATE, and exercises are identified by
    // NAME — plan ids churn on every rebuild, so an id-keyed lookup silently
    // orphans history (the v4.66/v4.68 bug class).
    function exNameOf(sess, lg){
      if(lg.name && String(lg.name).trim()) return String(lg.name).trim();
      const pm=planMap[sess.workoutId];
      return (pm&&pm.ex[lg.exId])||'Exercise';
    }
    function exercisePerformance(lg){
      let volume=0, totalReps=0, bestE=null, topSet=null, minutes=0, distance=0;
      (lg.sets||[]).forEach(st=>{
        const reps=num(st.reps), wt=num(st.weight), mn=num(st.min), km=num(st.km);
        if(reps!=null&&reps>0){
          totalReps+=reps;
          if(wt!=null&&wt>0){
            volume+=reps*wt;
            const est=e1rm(wt,reps);
            if(est!=null&&(bestE==null||est>bestE)){ bestE=est; topSet={reps,weight:wt}; }
          }
        }
        if(mn!=null&&mn>0) minutes+=mn;
        if(km!=null&&km>0) distance+=km;
      });
      if(volume>0) return {kind:'load',value:bestE,volume,bestE1rm:bestE,topSet};
      if(totalReps>0) return {kind:'reps',value:totalReps,reps:totalReps};
      if(distance>0) return {kind:'distance',value:distance,distance,minutes};
      if(minutes>0) return {kind:'time',value:minutes,minutes};
      return null;
    }
    function signedPct(v){
      if(v==null||!isFinite(v)) return null;
      const n=Math.round(v); return (n>0?'+':'')+n+'%';
    }
    function comparePerformance(now,prev){
      if(!prev) return {status:'new',changePct:null,remark:'First recorded baseline - compare it next time.'};
      if(now.kind!==prev.kind) return {status:'new',changePct:null,remark:'Tracking method changed - a new baseline was set.'};
      const p=(prev.value>0)?((now.value-prev.value)/prev.value*100):null;
      let decisive=p;
      let extra='';
      if(now.kind==='load'){
        const vp=(prev.volume>0)?((now.volume-prev.volume)/prev.volume*100):null;
        if((decisive==null||Math.abs(decisive)<=1.5)&&vp!=null&&Math.abs(vp)>1.5) decisive=vp;
        const nowSet=now.topSet?(now.topSet.weight+' kg x '+now.topSet.reps):'current top set';
        const oldSet=prev.topSet?(prev.topSet.weight+' kg x '+prev.topSet.reps):'previous top set';
        extra='Top set '+nowSet+' vs '+oldSet;
        if(vp!=null) extra+='; volume '+signedPct(vp);
      }else if(now.kind==='reps') extra=now.reps+' reps vs '+prev.reps;
      else if(now.kind==='distance') extra=r1(now.distance)+' km vs '+r1(prev.distance)+' km';
      else extra=Math.round(now.minutes)+' min vs '+Math.round(prev.minutes)+' min';
      const status=decisive==null?'new':(decisive>1.5?'up':(decisive<-1.5?'down':'flat'));
      const lead=status==='up'?'Improved '+signedPct(Math.abs(decisive)):
                 status==='down'?'Down '+signedPct(-Math.abs(decisive)):
                 status==='flat'?'Held steady':'New baseline';
      return {status,changePct:decisive,remark:lead+'. '+extra+'.'};
    }
    const inRange=new Set(); rows.forEach(r=>(r.dates||[]).forEach(d=>inRange.add(d)));
    const allSessions=(train.sessions||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const sessions=allSessions.filter(s=>inRange.has(s.date));

    // Exercise progress for a weekly report is measured against the immediately
    // previous performance, even when that baseline sits in an earlier week.
    // Loaded lifts use estimated strength first and total volume as the tie-break;
    // reps-only and cardio stay in their own units so unlike data is never mixed.
    const priorByExercise={}, progressByExercise={}, progressByOccurrence={};
    allSessions.forEach(s=>{
      if(!s.date||!A.meta.endDate||s.date>A.meta.endDate) return;
      (s.logs||[]).forEach(lg=>{
        const perf=exercisePerformance(lg); if(!perf) return;
        const name=exNameOf(s,lg), key=name.toLowerCase();
        if(inRange.has(s.date)){
          const cmp=comparePerformance(perf,priorByExercise[key]);
          const progress={name,date:s.date,status:cmp.status,
            changePct:cmp.changePct,remark:cmp.remark,kind:perf.kind};
          progressByExercise[key]=progress;
          progressByOccurrence[s.date+'|'+key]=progress;
        }
        priorByExercise[key]=perf;
      });
    });
    const progressOrder={up:0,down:1,flat:2,new:3};
    const exerciseProgress=Object.keys(progressByExercise).map(k=>progressByExercise[k])
      .sort((a,b)=>(progressOrder[a.status]-progressOrder[b.status])||a.name.localeCompare(b.name));

    const liftHist={};                       // exercise name -> [{date,bestE1rm,topSet,volume}]
    let tonnageTotal=0, hardSets=0, cardioMin=0, cardioKm=0, cardioSessions=0;
    const perWeekTon=rows.map(()=>0), perWeekSess=rows.map(()=>0);
    const realSessions=[];

    sessions.forEach(s=>{
      const wi=rows.findIndex(r=>(r.dates||[]).indexOf(s.date)>=0);
      let sTon=0, sSets=0, did=false, sMin=0, sKm=0;
      const detail=[];                       // printable per-exercise breakdown
      (s.logs||[]).forEach(lg=>{
        const nm=exNameOf(s,lg);
        let bestE=null, topSet=null, vol=0, setsDone=0;
        const shown=[];
        (lg.sets||[]).forEach(st=>{
          const reps=num(st.reps), wt=num(st.weight), mn=num(st.min), km=num(st.km);
          // Cardio set: minutes and/or distance, printed as one entry.
          if((mn!=null&&mn>0)||(km!=null&&km>0)){
            did=true;
            if(mn!=null&&mn>0) sMin+=mn;
            if(km!=null&&km>0) sKm+=km;
            const parts=[];
            if(mn!=null&&mn>0) parts.push(mn+' min');
            if(km!=null&&km>0) parts.push(km+' km');
            shown.push(parts.join(' · '));
          }
          // Strength set.
          if(reps!=null&&reps>0){
            did=true; setsDone++; sSets++;
            shown.push(reps+'×'+((wt!=null&&wt>0)?(wt+' kg'):'BW'));
            if(wt!=null&&wt>0){
              vol+=reps*wt;
              const e=e1rm(wt,reps);
              if(e!=null&&(bestE==null||e>bestE)){ bestE=e; topSet={reps,weight:wt}; }
            }
          }
        });
        sTon+=vol;
        if(shown.length) detail.push({name:nm, sets:shown, volume:Math.round(vol), bestE1rm:bestE,
          progress:progressByOccurrence[s.date+'|'+nm.toLowerCase()]||null});
        if(setsDone>0){
          if(!liftHist[nm]) liftHist[nm]=[];
          liftHist[nm].push({date:s.date, bestE1rm:bestE, topSet, volume:vol, sets:setsDone});
        }
      });
      if(!did) return;                       // a row existing is not a session performed
      realSessions.push({date:s.date, week:wi>=0?rows[wi].n:null,
                         name:(planMap[s.workoutId]&&planMap[s.workoutId].name)||s.workoutName||'Session',
                         tonnage:Math.round(sTon), sets:sSets, min:Math.round(sMin), km:r1(sKm),
                         notes:s.notes||'', exercises:detail});
      tonnageTotal+=sTon; hardSets+=sSets; cardioMin+=sMin; cardioKm+=sKm;
      if(sMin>0||sKm>0) cardioSessions++;
      if(wi>=0){ perWeekTon[wi]+=sTon; perWeekSess[wi]++; }
    });

    const lifts=Object.keys(liftHist).map(nm=>{
      const h=liftHist[nm].filter(x=>x.bestE1rm!=null);
      const all=liftHist[nm];
      const first=h.length?h[0]:null, last=h.length?h[h.length-1]:null;
      return {
        name:nm, sessions:all.length, totalSets:all.reduce((s,x)=>s+x.sets,0),
        volume:Math.round(all.reduce((s,x)=>s+x.volume,0)),
        first, last,
        deltaPct:(first&&last&&h.length>=2&&first.bestE1rm)?((last.bestE1rm-first.bestE1rm)/first.bestE1rm*100):null
      };
    }).sort((a,b)=>b.volume-a.volume);

    const tonPts=perWeekTon.map((t,i)=>({x:i,y:t>0?t:null}));
    A.training={
      sessions:realSessions.length,
      list:realSessions,
      perWeek:perWeekSess,
      perWeekTonnage:perWeekTon.map(t=>Math.round(t)),
      sessionsPerWeek: weeks?r1(realSessions.length/weeks):null,
      tonnage:Math.round(tonnageTotal),
      hardSets,
      tonnageSlope:slope(tonPts),
      // Half-block means, not first week versus last. A single week can carry one
      // session or four, and "volume up 350 %" off the back of that is a number
      // that flatters the reader rather than informing them.
      tonnageFirst: (function(){
        const t=perWeekTon.filter(x=>x>0); if(!t.length) return null;
        const h=Math.max(1,Math.floor(t.length/2));
        return Math.round(mean(t.slice(0,h)));
      })(),
      tonnageLast: (function(){
        const t=perWeekTon.filter(x=>x>0); if(!t.length) return null;
        const h=Math.max(1,Math.floor(t.length/2));
        return Math.round(mean(t.slice(t.length-h)));
      })(),
      tonnagePerSession: null,
      cardioMin:Math.round(cardioMin), cardioKm:r1(cardioKm), cardioSessions,
      lifts, topLifts:lifts.slice(0,6),
      exerciseProgress,
      progressCounts:{
        up:exerciseProgress.filter(x=>x.status==='up').length,
        down:exerciseProgress.filter(x=>x.status==='down').length,
        flat:exerciseProgress.filter(x=>x.status==='flat').length,
        new:exerciseProgress.filter(x=>x.status==='new').length
      },
      gainers:lifts.filter(l=>l.deltaPct!=null&&l.deltaPct>=2).sort((a,b)=>b.deltaPct-a.deltaPct),
      stalled:lifts.filter(l=>l.deltaPct!=null&&l.deltaPct<1&&l.sessions>=2),
      blankWeeks:perWeekSess.map((c,i)=>c===0?rows[i].n:null).filter(x=>x!=null)
    };
    A.training.tonnageChangePct=(A.training.tonnageFirst&&A.training.tonnageLast&&weeks>=2)
      ? ((A.training.tonnageLast-A.training.tonnageFirst)/A.training.tonnageFirst*100) : null;
    A.training.tonnagePerSession=realSessions.length?Math.round(tonnageTotal/realSessions.length):null;

    /* --- nutrition --- */
    const nDays=allDays.filter(d=>d.food);
    const tgt=nut.targets||{};
    const tCal=num(tgt.cal), tP=num(tgt.p), tC=num(tgt.c), tF=num(tgt.f);
    const cals=nDays.map(d=>d.food.cal), prots=nDays.map(d=>d.food.p);
    const weekdayCal=mean(nDays.filter(d=>d.idx<5).map(d=>d.food.cal));
    const weekendCal=mean(nDays.filter(d=>d.idx>=5).map(d=>d.food.cal));
    const bodyKg=lastBw!=null?lastBw:A.meta.startWeight;
    const perWeekNut=rows.map(r=>{
      const fd=r.days.filter(d=>d.food);
      return {n:r.n, days:fd.length, cal:fd.length?Math.round(mean(fd.map(d=>d.food.cal))):null,
              p:fd.length?Math.round(mean(fd.map(d=>d.food.p))):null};
    });
    A.nutrition={
      daysLogged:nDays.length,
      coverage:Math.round(nDays.length/(weeks*7)*100),
      target:{cal:tCal,p:tP,c:tC,f:tF},
      avgCal:cals.length?Math.round(mean(cals)):null,
      avgP:prots.length?Math.round(mean(prots)):null,
      avgC:nDays.length?Math.round(mean(nDays.map(d=>d.food.c))):null,
      avgF:nDays.length?Math.round(mean(nDays.map(d=>d.food.f))):null,
      calSd:cals.length>1?Math.round(sd(cals)):null,
      overTargetDays:(tCal!=null)?nDays.filter(d=>d.food.cal>tCal*1.1).length:null,
      underTargetDays:(tCal!=null)?nDays.filter(d=>d.food.cal<tCal*0.9).length:null,
      onTargetDays:(tCal!=null)?nDays.filter(d=>Math.abs(d.food.cal-tCal)<=tCal*0.1).length:null,
      weekdayCal:weekdayCal==null?null:Math.round(weekdayCal),
      weekendCal:weekendCal==null?null:Math.round(weekendCal),
      weekendDrift:(weekdayCal!=null&&weekendCal!=null)?Math.round(weekendCal-weekdayCal):null,
      proteinPerKg:(prots.length&&bodyKg)?r1(mean(prots)/bodyKg):null,
      bodyKg:bodyKg?r1(bodyKg):null,
      perWeek:perWeekNut,
      biggestDay:nDays.length?nDays.reduce((a,b)=>b.food.cal>a.food.cal?b:a):null,
      leanestDay:nDays.length?nDays.reduce((a,b)=>b.food.cal<a.food.cal?b:a):null
    };
    const hasTargets=[tCal,tP,tC,tF].some(x=>x!=null&&x>0);
    A.nutrition.daily=allDays.map(d=>{
      if(!d.food) return {date:d.date,label:d.label,status:'unlogged',remark:'No food logged.'};
      if(!hasTargets) return {date:d.date,label:d.label,status:'logged',remark:'Logged - daily macro targets are not set.'};
      const misses=[];
      function band(label,value,target,tolerance,minimumOnly,unit){
        if(target==null||target<=0) return;
        const low=target*(1-tolerance), high=target*(1+tolerance);
        if(value<low) misses.push(label+' '+Math.round(target-value)+(unit||'')+' short');
        else if(!minimumOnly&&value>high) misses.push(label+' '+Math.round(value-target)+(unit||'')+' over');
      }
      band('Calories',d.food.cal,tCal,.10,false,' kcal');
      band('Protein',d.food.p,tP,.10,true,' g');
      band('Carbs',d.food.c,tC,.15,false,' g');
      band('Fat',d.food.f,tF,.15,false,' g');
      return {date:d.date,label:d.label,status:misses.length?'missed':'met',
        remark:misses.length?misses.join('; '):'All configured targets met.'};
    });
    A.nutrition.adherence={
      hasTargets,
      met:A.nutrition.daily.filter(x=>x.status==='met').length,
      missed:A.nutrition.daily.filter(x=>x.status==='missed').length,
      unlogged:A.nutrition.daily.filter(x=>x.status==='unlogged').length,
      loggedNoTargets:A.nutrition.daily.filter(x=>x.status==='logged').length
    };
    if(A.nutrition.avgCal!=null&&tCal!=null) A.nutrition.calDelta=A.nutrition.avgCal-tCal;
    if(A.nutrition.avgP!=null&&tP!=null) A.nutrition.pDelta=A.nutrition.avgP-tP;

    /* --- sleep --- */
    const slDays=allDays.filter(d=>d.sleep!=null);
    A.sleep={
      daysLogged:slDays.length,
      coverage:Math.round(slDays.length/(weeks*7)*100),
      avg:slDays.length?r1(mean(slDays.map(d=>d.sleep))):null,
      sd:slDays.length>1?r1(sd(slDays.map(d=>d.sleep))):null,
      inBand:slDays.filter(d=>d.sleep>=7&&d.sleep<=9).length,
      short:slDays.filter(d=>d.sleep<6).length,
      best:slDays.length?slDays.reduce((a,b)=>b.sleep>a.sleep?b:a):null,
      worst:slDays.length?slDays.reduce((a,b)=>b.sleep<a.sleep?b:a):null,
      perWeek:rows.map(r=>({n:r.n,avg:r.sleepAvg,days:r.sleepDays}))
    };
    A.sleep.inBandPct=slDays.length?Math.round(A.sleep.inBand/slDays.length*100):null;

    /* --- steps --- */
    const stDays=allDays.filter(d=>d.steps!=null);
    A.steps={
      daysLogged:stDays.length,
      coverage:Math.round(stDays.length/(weeks*7)*100),
      avg:stDays.length?Math.round(mean(stDays.map(d=>d.steps))):null,
      at8k:stDays.filter(d=>d.steps>=8000).length,
      under5k:stDays.filter(d=>d.steps<5000).length,
      best:stDays.length?stDays.reduce((a,b)=>b.steps>a.steps?b:a):null,
      worst:stDays.length?stDays.reduce((a,b)=>b.steps<a.steps?b:a):null,
      total:stDays.length?stDays.reduce((s,d)=>s+d.steps,0):null,
      perWeek:rows.map(r=>({n:r.n,avg:r.stepsAvg,days:r.stepsDays}))
    };
    A.steps.at8kPct=stDays.length?Math.round(A.steps.at8k/stDays.length*100):null;

    /* --- check-ins / recovery --- */
    function tally(field){ const t={}; rows.forEach(r=>{ const v=r.ci&&r.ci[field]; if(v) t[v]=(t[v]||0)+1; }); return t; }
    A.checkin={
      overload:tally('overload'), diet:tally('diet'), stress:tally('stress'),
      done:rows.filter(r=>r.ci&&(r.ci.overload||r.ci.diet||r.ci.stress||r.ci.bf)).length,
      notes:rows.filter(r=>r.ci&&r.ci.notes&&r.ci.notes.trim()).map(r=>({n:r.n,range:r.range,text:r.ci.notes.trim()}))
    };
    A.checkin.highStress=(A.checkin.stress.high||0);

    /* --- overall engagement --- */
    const anyLog=allDays.filter(d=>d.bw!=null||d.steps!=null||d.sleep!=null||d.food||d.sessions.length);
    let bestStreak=0,cur=0;
    allDays.forEach(d=>{
      const on=(d.bw!=null||d.steps!=null||d.sleep!=null||d.food||d.sessions.length);
      cur=on?cur+1:0; if(cur>bestStreak) bestStreak=cur;
    });
    A.engagement={ activeDays:anyLog.length, totalDays:weeks*7,
                   pct:Math.round(anyLog.length/(weeks*7)*100), bestStreak };

    return A;
  }

  /* ================= SUMMARY LINES =================
     Deliberately NOT prose.

     The first version of this wrote a coaching essay under every chart — what
     happened, why it matters, the verdict, the mechanism, the citation. It was
     accurate and it was far too much to read, which means it did not get read.
     What someone actually wants off a progress report is the direction of
     travel and a clean record of what they logged.

     So: one stat line per topic, sized to sit under its chart, and everything
     else is the chart and the table. If a line needs a second sentence it is
     the wrong line. */

  function pl(n,w,ws){ return n+' '+(n===1?w:(ws||w+'s')); }
  function dot(parts){ return parts.filter(Boolean).join('   ·   '); }
  function sgn(n){ return (n>0?'+':'')+n; }

  function statLines(A){
    const W=A.weight, T=A.training, N=A.nutrition, S=A.sleep, P=A.steps;
    const L={};

    // "82.2 to 82.2 kg" is what a single week produces if you always print the
    // range — there is only one weekly average to compare against itself.
    const oneWeekOfWeight = (W.change==null && W.last!=null);
    L.weight = W.daysLogged ? dot([
      oneWeekOfWeight ? (f1(W.last)+' kg average')
                      : ((W.first!=null&&W.last!=null) ? (f1(W.first)+' to '+f1(W.last)+' kg') : null),
      W.change!=null ? (sgn(f1(W.change))+' kg') : null,
      W.ratePctWk!=null ? (sgn(f1(W.ratePctWk))+' % a week') : null,
      pl(W.daysLogged,'weigh-in'),
      W.plateau ? 'flat for 3 weeks' : null
    ]) : 'No weigh-ins logged in this period.';

    L.training = T.sessions ? dot([
      pl(T.sessions,'session'),
      T.sessionsPerWeek+' a week',
      kcal(T.tonnage)+' kg lifted',
      T.tonnageChangePct!=null ? ('weekly volume '+sgn(Math.round(T.tonnageChangePct))+' %') : null,
      T.cardioMin ? (T.cardioMin+' min cardio') : null
    ]) : 'No sessions logged in this period.';

    L.lifts = T.gainers && T.gainers.length
      ? ('Getting stronger: '+T.gainers.slice(0,4).map(l=>l.name+' '+sgn(Math.round(l.deltaPct))+' %').join('   ·   '))
      : null;

    L.nutrition = N.daysLogged ? dot([
      kcal(N.avgCal)+' kcal a day',
      N.target.cal ? ('target '+kcal(N.target.cal)) : null,
      N.calDelta!=null ? (sgn(kcal(N.calDelta))+' a day') : null,
      N.avgP+' g protein',
      N.proteinPerKg ? (N.proteinPerKg+' g/kg') : null,
      N.daysLogged+' of '+A.meta.calendarDays+' days logged'
    ]) : 'No food logged in this period.';

    const rec=[];
    if(S.daysLogged) rec.push(S.avg+' h sleep', S.inBand+' of '+S.daysLogged+' nights in 7-9 h');
    if(P.daysLogged) rec.push(kcal(P.avg)+' steps a day', P.at8k+' days over 8,000');
    L.recovery = rec.length ? dot(rec) : 'No sleep or step data logged in this period.';

    L.score = A.score.avg!=null
      ? dot([ A.score.avg+' % average', A.score.grade,
              A.score.best ? ('best W'+A.score.best.n+' at '+A.score.best.score+' %') : null,
              A.score.drift!=null&&Math.abs(A.score.drift)>=5
                ? ('second half '+sgn(A.score.drift)+' points') : null ])
      : 'Not enough logged to score.';

    L.consistency = dot([
      A.engagement.activeDays+' of '+A.engagement.totalDays+' days active',
      A.engagement.pct+' %',
      'longest streak '+pl(A.engagement.bestStreak,'day')
    ]);

    return L;
  }

  /* ---- what to fix, three lines, biggest first ----
     Ranked by impact, one line each, and every line carries the number it is
     about. No rationale — the chart above it is the rationale. */
  function focus(A){
    const out=[];
    const N=A.nutrition, W=A.weight, T=A.training, S=A.sleep, P=A.steps;
    const add=(impact,text)=>out.push({impact,text});

    if(N.coverage!=null&&N.coverage<70)
      add(95,'Log food every day — only '+N.coverage+' % of days were logged.');
    if(N.proteinPerKg!=null&&N.proteinPerKg<1.6&&N.bodyKg)
      add(85,'Protein up to '+Math.round(1.6*N.bodyKg)+' g a day — currently '+N.avgP+' g.');
    if(N.calDelta!=null&&N.calDelta>150)
      add(84,'Calories are '+kcal(N.calDelta)+' a day over target.');
    if(N.calDelta!=null&&N.calDelta<-150)
      add(68,'Calories are '+kcal(Math.abs(N.calDelta))+' a day under target.');
    if(T.sessionsPerWeek!=null&&T.sessionsPerWeek<3)
      add(88,'Train three times a week — currently '+T.sessionsPerWeek+'.');
    if(T.sessions&&T.tonnageChangePct!=null&&T.tonnageChangePct<5)
      add(62,'Volume is flat — add a set or a few reps to your main lifts.');
    if(W.plateau)
      add(80,'Weight has not moved for three weeks.');
    if(S.avg!=null&&S.avg<7)
      add(72,'Sleep up to 7 hours — currently '+S.avg+' h.');
    if(P.avg!=null&&P.avg<7250)
      add(58,'Steps up to 8,000 a day — currently '+kcal(P.avg)+'.');
    if(A.checkin.highStress>=2)
      add(65,'High stress in '+pl(A.checkin.highStress,'week')+' — plan those weeks lighter.');
    if(A.checkin.done<A.meta.weeks)
      add(40,'Fill in the weekly check-in — '+A.checkin.done+' of '+A.meta.weeks+' done.');
    if(N.weekendDrift!=null&&N.weekendDrift>=300)
      add(70,'Weekends run '+kcal(N.weekendDrift)+' kcal a day above weekdays.');

    if(!out.length) add(1,'Everything measured is on track — run this block again.');
    return out.sort((a,b)=>b.impact-a.impact).slice(0,3).map(x=>x.text);
  }

  function summarize(A){
    return { lines: statLines(A), focus: focus(A) };
  }

  return { analyze, summarize, monthPresets, reportName,
           fmtDay, fmtFull, fmtSpan, DLAB, e1rm, mean, slope, r1, f1 };
})();
