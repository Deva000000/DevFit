/* DevFit — report engine (analysis + narrative)
   ------------------------------------------------------------------
   One place that (a) reads every logged source for a span of weeks and
   (b) turns those numbers into the words a coach would actually say.

   Why this file exists:
   • The old Program Report was a table of week numbers. No dates, no food,
     no training, no sentences — nothing a paying client could read and act on.
   • Both PDF exports needed the SAME analysis. Writing it twice is exactly the
     app-vs-report drift that scoring.js was created to kill, so the maths and
     the prose live here and both reports call in.

   Contract: every function is null-safe. A half-logged week, a missing
   programStart, an empty food diary — all resolve to "not enough logged
   to judge", never to a crash and never to an invented number.

   Evidence anchors used in the written sections:
   • Rate of loss 0.5–1.0 %BW/wk spares lean mass — Helms 2014 (JISSN); Garthe 2011.
   • Lean gain 0.25–0.5 %BW/wk — Aragon & Schoenfeld 2013.
   • Protein 1.6–2.2 g/kg/day for hypertrophy & lean retention — Morton 2018 (BJSM).
   • Steps benefit plateaus ~8,000–10,000/day — Paluch 2022 (Lancet Public Health).
   • Sleep 7–9 h; restriction shifts loss toward lean mass — Hirshkowitz 2015; Nedeltcheva 2010.
   • 10–20 hard sets per muscle per week drives hypertrophy — Schoenfeld 2017.

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
    const inRange=new Set(); rows.forEach(r=>(r.dates||[]).forEach(d=>inRange.add(d)));
    const sessions=(train.sessions||[]).filter(s=>inRange.has(s.date)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));

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
        if(shown.length) detail.push({name:nm, sets:shown, volume:Math.round(vol), bestE1rm:bestE});
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

  /* ================= NARRATIVE =================
     Everything below writes sentences. Rules it follows:
     • Never invent a number. If it is not logged, the text says so and says
       what logging it would buy.
     • Always give the mechanism, not just the verdict — that is the difference
       between a dashboard and a coach.
     • Always end a section with one instruction that has a number in it. */

  function pl(n,w,ws){ return n+' '+(n===1?w:(ws||w+'s')); }
  function join(parts){ return parts.filter(Boolean).join(' '); }

  /* ---- executive summary ---- */
  function headline(A){
    const p=[];
    const m=A.meta;
    p.push('This report covers '+(m.single?('week '+(m.startW+1)):(pl(m.weeks,'week')+', week '+(m.startW+1)+' through week '+(m.endW+1)))+
           (m.span?(', '+m.span):'')+'.');
    p.push('Over those '+m.calendarDays+' days you logged something on '+A.engagement.activeDays+
           ' of them ('+A.engagement.pct+'%), with a best unbroken streak of '+pl(A.engagement.bestStreak,'day')+'.');

    const bits=[];
    if(A.weight.daysLogged) bits.push('bodyweight on '+pl(A.weight.daysLogged,'day'));
    if(A.nutrition.daysLogged) bits.push('food on '+pl(A.nutrition.daysLogged,'day'));
    if(A.training.sessions) bits.push(pl(A.training.sessions,'training session')+' completed');
    if(A.sleep.daysLogged) bits.push('sleep on '+pl(A.sleep.daysLogged,'night'));
    if(bits.length) p.push('That breaks down as '+bits.join(', ')+'.');

    if(A.weight.change!=null){
      const dir=A.weight.change<0?'down':(A.weight.change>0?'up':'level');
      p.push('Bodyweight went from '+f1(A.weight.first)+' kg to '+f1(A.weight.last)+' kg — '+
             dir+' '+f1(Math.abs(A.weight.change))+' kg'+
             (A.weight.ratePctWk!=null?(', a trend of '+f1(Math.abs(A.weight.ratePctWk))+' % of bodyweight per week'):'')+'.');
    } else if(A.weight.daysLogged<2){
      p.push('There is not enough bodyweight data in this block to call a direction — weigh in at least three mornings a week and the next report can.');
    }

    if(A.score.avg!=null){
      p.push('The weighted progress score averaged '+A.score.avg+' % ('+A.score.grade+')'+
             (A.score.best?(', peaking at '+A.score.best.score+' % in week '+A.score.best.n):'')+'.');
      if(A.score.drift!=null&&Math.abs(A.score.drift)>=5){
        p.push(A.score.drift>0
          ? 'The second half of the block scored '+A.score.drift+' points higher than the first — you finished stronger than you started, which is the shape you want.'
          : 'The second half scored '+Math.abs(A.score.drift)+' points lower than the first — the block faded, and the sections below show where.');
      }
    }

    if(A.strongest.length) p.push('Your strongest signal was '+A.strongest[0].label.toLowerCase()+' at '+A.strongest[0].avg+' %.');
    if(A.weakest.length){
      const w=A.weakest[0];
      p.push('The biggest single opportunity is '+w.label.toLowerCase()+': it averaged '+w.avg+
             ' % and carries '+w.weight+' % of the score, so there are about '+w.lever+
             ' points sitting unclaimed there — more than any other signal in this block.');
    }
    return p.join(' ');
  }

  /* ---- bodyweight ---- */
  function weightSection(A){
    const W=A.weight, gt=A.meta.goalType;
    const out={trend:'',theory:'',verdict:'',flag:null};

    if(W.daysLogged===0){
      out.trend='No bodyweight was logged in this block, so there is nothing to trend.';
      out.theory='Scale weight is noisy day to day — food in the gut, water, salt and sleep can swing it a kilo either way — which is exactly why it is read as a weekly average, never as a single morning. Three to four weigh-ins a week, same time, after the toilet, before food, is enough to average out the noise.';
      out.verdict='Action: weigh in on at least three mornings this week so the next report can tell you whether the plan is working.';
      return out;
    }

    const t=[];
    t.push('Weighed in on '+pl(W.daysLogged,'day')+' of '+A.meta.calendarDays+' ('+W.coverage+' % coverage). '+
           'Weekly averages ran '+A.rows.filter(r=>r.bwAvg!=null).map(r=>'W'+r.n+' '+f1(r.bwAvg)).join(', ')+' kg.');
    if(W.change!=null){
      t.push('Net movement '+(W.change>0?'+':'')+f1(W.change)+' kg over the block, a fitted trend of '+
             (W.ratePerWeek>0?'+':'')+f1(W.ratePerWeek)+' kg per week'+
             (W.ratePctWk!=null?(' ('+(W.ratePctWk>0?'+':'')+f1(W.ratePctWk)+' % of bodyweight per week)'):'')+'.');
    }
    if(W.lowest&&W.highest&&W.lowest.date&&W.highest.date){
      t.push('Lightest reading '+f1(W.lowest.bw)+' kg on '+fmtDay(W.lowest.date)+', heaviest '+f1(W.highest.bw)+' kg on '+fmtDay(W.highest.date)+'.');
    }
    if(W.bfChange!=null){
      t.push('Body-fat check-ins moved from '+f1(W.bfFirst.v)+' % to '+f1(W.bfLast.v)+' % ('+(W.bfChange>0?'+':'')+f1(W.bfChange)+' points).');
    }
    out.trend=t.join(' ');

    if(gt==='loss'){
      out.theory='The target band for fat loss is 0.5 to 1.0 % of bodyweight per week. At '+
        (W.last!=null?f1(W.last)+' kg that is roughly '+f1(W.last*0.005)+' to '+f1(W.last*0.01)+' kg a week':'your current weight')+
        '. Go slower and the diet drags on long enough that adherence dies before the result arrives; go faster and an increasing share of what you lose is muscle, not fat, because the deficit outruns what stored fat can release per day (Helms 2014; Garthe 2011). The scale is the crude instrument here — it cannot separate fat from muscle from water — so it is read alongside strength on the bar and the tape, not on its own.';
    } else if(gt==='gain'){
      out.theory='Lean tissue accrues slowly. Beyond the first months of training, 0.25 to 0.5 % of bodyweight per week is about the ceiling for gain that stays mostly muscle (Aragon & Schoenfeld 2013). At '+
        (W.last!=null?f1(W.last)+' kg that is '+f1(W.last*0.0025)+' to '+f1(W.last*0.005)+' kg a week':'your bodyweight')+
        '. Faster than that and the surplus is being stored rather than built with, which just buys a longer cut later.';
    } else {
      out.theory='On a maintain goal the job is stability, not movement: staying inside about half a percent of bodyweight either way, week to week. Drift outside that band for three weeks running and you are on a slow bulk or a slow cut without having chosen one.';
    }

    const v=[];
    if(W.band==='ideal') v.push('Verdict: the rate is sitting in the evidence-based band. Change nothing about calories — hold the line and let it run.');
    else if(W.band==='fast') v.push('Verdict: the rate is faster than the band. That usually feels like winning and reads as muscle loss later. Add about 150 to 250 kcal a day, mostly carbohydrate around training, and re-check in two weeks.');
    else if(W.band==='slow') v.push('Verdict: moving in the right direction but under the band. Before touching calories, check the food log is complete — unlogged oils, drinks and bites are the usual cause. If the log is honest, trim 100 to 200 kcal a day or add 2,000 steps.');
    else if(W.band==='flat') v.push('Verdict: essentially flat. Bodyweight is not responding, which means intake and output are currently balanced regardless of what the plan says on paper.');
    else if(W.band==='wrong') v.push('Verdict: weight is moving against the stated goal. That is not a failure of effort, it is a mismatch between what the plan assumes and what is actually going in — the nutrition section is where to look.');

    if(W.plateau){
      v.push('The last three weekly averages sit inside a 0.4 % band, which is a genuine plateau rather than a slow week. Two things drive this: energy expenditure falls as you get lighter and as unconscious daily movement drops, and portion creep quietly returns after a few weeks of dieting. The fix is one variable at a time — restore step count first, tighten logging second, cut calories last.');
      out.flag='plateau';
    }
    if(W.toTarget!=null&&W.target!=null){
      if((gt==='loss'&&W.toTarget<=0)||(gt==='gain'&&W.toTarget>=0)) v.push('You have reached the '+f1(W.target)+' kg target. The next block should be about holding it, not chasing further.');
      else v.push(f1(Math.abs(W.toTarget))+' kg to go to the '+f1(W.target)+' kg target'+
        (W.etaWeeks?(', which at the current trend arrives in about '+pl(W.etaWeeks,'week')+(W.etaDate?(' — around '+W.etaDate):'')):', though the current trend is too flat to project a date')+'.');
    }
    if(W.coverage<40) v.push('Note: at '+W.coverage+' % weigh-in coverage this trend is built on thin data. Treat it as a direction, not a measurement.');
    out.verdict=v.join(' ');
    return out;
  }

  /* ---- training ---- */
  function trainingSection(A){
    const T=A.training;
    const out={trend:'',theory:'',verdict:''};

    if(T.sessions===0){
      out.trend='No training sessions were logged against these dates.';
      out.theory='Everything else in this report is downstream of training. In a deficit, resistance training is the signal that tells the body to keep muscle while it spends fat; without it, weight still falls but a meaningful share of the loss is lean tissue, and the face-and-shoulders result people actually want does not arrive.';
      out.verdict='Action: log every session, even a partial one. An unlogged session is an unmeasurable one, and a report cannot coach what it cannot see.';
      return out;
    }

    const t=[];
    t.push('Completed '+pl(T.sessions,'session')+' across '+pl(A.meta.weeks,'week')+' — an average of '+T.sessionsPerWeek+' a week — covering '+
           pl(T.hardSets,'working set')+' and '+kcal(T.tonnage)+' kg of total volume moved.');
    if(A.meta.weeks>1){
      t.push('Sessions by week: '+T.perWeek.map((c,i)=>'W'+A.rows[i].n+' '+c).join(', ')+'.');
    }
    if(T.blankWeeks.length) t.push('No sessions at all in '+(T.blankWeeks.length===1?'week ':'weeks ')+T.blankWeeks.join(', ')+'.');
    if(T.tonnagePerSession) t.push('That averages '+kcal(T.tonnagePerSession)+' kg per session.');
    if(T.tonnageChangePct!=null&&A.meta.weeks>1){
      t.push('Comparing the first half of the block with the second, average weekly volume went from '+
             kcal(T.tonnageFirst)+' kg to '+kcal(T.tonnageLast)+' kg, '+
             (T.tonnageChangePct>=0?'up ':'down ')+Math.abs(Math.round(T.tonnageChangePct))+' %.');
    }
    if(T.cardioSessions) t.push('Cardio: '+pl(T.cardioSessions,'session')+', '+T.cardioMin+' minutes'+(T.cardioKm>0?(' and '+f1(T.cardioKm)+' km'):'')+'.');
    if(T.gainers.length){
      t.push('Estimated one-rep max improved on '+pl(T.gainers.length,'lift')+', led by '+
             T.gainers.slice(0,3).map(l=>l.name+' +'+Math.round(l.deltaPct)+' %'+
               (l.last&&l.last.topSet?(' (to '+l.last.topSet.reps+'×'+f1(l.last.topSet.weight)+' kg)'):'')).join(', ')+'.');
    }
    if(T.stalled.length){
      t.push('Flat or regressing: '+T.stalled.slice(0,4).map(l=>l.name).join(', ')+'.');
    }
    out.trend=t.join(' ');

    out.theory='Progressive overload is the whole mechanism: muscle adapts to a demand it has met before only if the demand keeps rising. The honest measure is not how tired a session felt but whether load, reps or quality sets went up over time, which is why estimated one-rep max is tracked rather than raw weight — eight reps at 60 kg is more work than five at 65 kg, and only the estimate says so. Volume is the dose that drives growth, with roughly 10 to 20 hard sets per muscle per week the productive range for most people (Schoenfeld 2017); below it you maintain, far above it you accumulate fatigue you cannot recover from. In a deficit, holding load is already a win — the goal shifts from adding weight to not losing it.';

    const v=[];
    if(T.sessionsPerWeek>=3) v.push('Verdict: attendance is where it needs to be at '+T.sessionsPerWeek+' sessions a week. That frequency is enough to hit each muscle group twice, which is the setup that works.');
    else if(T.sessionsPerWeek>=2) v.push('Verdict: '+T.sessionsPerWeek+' sessions a week maintains but does not build much. Adding a third session is the single highest-return change available to you.');
    else v.push('Verdict: at '+T.sessionsPerWeek+' sessions a week the stimulus is too thin and too spread out to drive adaptation. Two full-body sessions a week beat one long one.');

    if(T.tonnageChangePct!=null){
      if(T.tonnageChangePct>=10) v.push('Volume is climbing '+Math.round(T.tonnageChangePct)+' %, which is real overload rather than the same work repeated. Keep the increases small enough that form holds.');
      else if(T.tonnageChangePct<=-15) v.push('Volume dropped '+Math.abs(Math.round(T.tonnageChangePct))+' % across the block. If that was a planned deload, fine; if not, it is the reason the strength numbers have not moved.');
      else v.push('Volume is broadly flat, which means the body is being asked to do what it already knows how to do. Add one set to your two main lifts, or two to three reps at the same load, and re-test in two weeks.');
    }
    if(T.stalled.length>=2){
      v.push('Action: '+T.stalled.slice(0,2).map(l=>l.name).join(' and ')+' have not moved. Pick one and drive it — add 2.5 kg or one rep per set per session for the next three sessions, and if it still will not move, the limiter is recovery or technique, not effort.');
    } else if(T.gainers.length){
      v.push('Action: keep the progression on '+T.gainers[0].name+' running at the same increment; it is responding.');
    }
    out.verdict=v.join(' ');
    return out;
  }

  /* ---- nutrition ---- */
  function nutritionSection(A){
    const N=A.nutrition;
    const out={trend:'',theory:'',verdict:''};

    if(N.daysLogged===0){
      out.trend='No food was logged in this block.';
      out.theory='Nutrition carries the largest single weight in the score for a reason: training is the signal but food is the substrate, and no amount of work in the gym outruns an intake that is not accounted for. People routinely under-estimate what they eat by 20 to 40 % when guessing, which is not dishonesty — it is that oils, drinks, sauces and handfuls are genuinely invisible until they are written down.';
      out.verdict='Action: log food for seven consecutive days — including the days that go badly, which are the informative ones. Until then, every nutrition judgement in this report is guesswork.';
      return out;
    }

    const t=[];
    t.push('Logged food on '+pl(N.daysLogged,'day')+' of '+A.meta.calendarDays+' ('+N.coverage+' % coverage), averaging '+
           kcal(N.avgCal)+' kcal a day'+(N.target.cal?(' against a '+kcal(N.target.cal)+' kcal target'):'')+'.');
    if(N.calDelta!=null) t.push('That is '+(N.calDelta>0?'+':'')+kcal(N.calDelta)+' kcal a day versus target'+
      (N.onTargetDays!=null?(', with '+N.onTargetDays+' days inside 10 % of it, '+N.overTargetDays+' over and '+N.underTargetDays+' under'):'')+'.');
    t.push('Macros averaged '+N.avgP+' g protein'+(N.target.p?(' (target '+N.target.p+' g)'):'')+', '+N.avgC+' g carbs, '+N.avgF+' g fat.');
    if(N.proteinPerKg!=null) t.push('At '+N.bodyKg+' kg that is '+N.proteinPerKg+' g of protein per kg of bodyweight.');
    if(N.calSd!=null) t.push('Day-to-day swing was '+kcal(N.calSd)+' kcal (standard deviation).');
    if(N.weekendDrift!=null&&Math.abs(N.weekendDrift)>=150){
      t.push('Weekdays averaged '+kcal(N.weekdayCal)+' kcal, weekends '+kcal(N.weekendCal)+' kcal — a '+
             (N.weekendDrift>0?'rise':'drop')+' of '+kcal(Math.abs(N.weekendDrift))+' kcal on Saturday and Sunday.');
    }
    if(N.biggestDay&&N.biggestDay.date) t.push('Biggest day '+kcal(N.biggestDay.food.cal)+' kcal on '+fmtDay(N.biggestDay.date)+
      '; leanest '+kcal(N.leanestDay.food.cal)+' kcal on '+fmtDay(N.leanestDay.date)+'.');
    out.trend=t.join(' ');

    out.theory='Two things decide whether nutrition is working. The first is total energy: bodyweight follows the balance between what comes in and what goes out over weeks, and no food is inherently fattening or slimming outside that arithmetic. The second is protein, which is what protects muscle while the balance is negative — 1.6 to 2.2 g per kg of bodyweight per day is where the evidence stops showing further benefit (Morton 2018), and hitting it matters more than the timing or the source. Consistency beats precision: a diet run at 90 % accuracy every day outperforms a perfect one abandoned on day nine, and the standard failure mode is not a bad plan but four disciplined weekdays undone by two unlogged weekend days.';

    const v=[];
    if(N.proteinPerKg!=null){
      if(N.proteinPerKg>=1.6) v.push('Verdict: protein is sufficient at '+N.proteinPerKg+' g/kg. Hold it — this is the number protecting muscle while weight moves.');
      else if(N.proteinPerKg>=1.2) v.push('Verdict: protein at '+N.proteinPerKg+' g/kg is under the range. Add roughly '+Math.round((1.6-N.proteinPerKg)*N.bodyKg)+' g a day — one more protein-led meal or a shake covers it.');
      else v.push('Verdict: protein at '+N.proteinPerKg+' g/kg is well short and is the most likely reason strength stalls while weight falls. Target '+Math.round(1.6*N.bodyKg)+' to '+Math.round(2.0*N.bodyKg)+' g a day.');
    } else if(N.avgP!=null){
      v.push('Verdict: averaging '+N.avgP+' g of protein a day. Log a bodyweight so this can be judged per kilo rather than in the abstract.');
    }
    if(N.calDelta!=null){
      const over=N.calDelta>0;
      if(Math.abs(N.calDelta)<=100) v.push('Calories are effectively on target — within '+kcal(Math.abs(N.calDelta))+' kcal a day. That is the hard part done.');
      else if(over) v.push('Running '+kcal(N.calDelta)+' kcal a day over target adds up to roughly '+kcal(N.calDelta*7)+
        ' kcal a week — about '+f1(N.calDelta*7/7700)+' kg of fat a week you are not losing, which over a 12-week block is '+
        f1(N.calDelta*7*12/7700)+' kg of result left behind.');
      else v.push('Running '+kcal(Math.abs(N.calDelta))+' kcal a day under target. Under-eating is not a shortcut — it costs training quality and recovery first, and it is the usual reason a deficit stops being sustainable.');
    }
    if(N.coverage<50) v.push('At '+N.coverage+' % logging coverage the averages above describe your logged days, not your week. The unlogged days are almost never the light ones.');
    if(N.weekendDrift!=null&&N.weekendDrift>=300) v.push('Action: the weekend costs you about '+kcal(N.weekendDrift*2)+' kcal every week. You do not need a stricter weekend — pull 150 kcal off each weekday and the week balances without touching Saturday.');
    if(N.calSd!=null&&N.avgCal&&N.calSd/N.avgCal>0.25) v.push('Intake swings more than a quarter of the daily average day to day. Steadier days make the trend readable and hunger easier to manage.');
    out.verdict=v.join(' ');
    return out;
  }

  /* ---- sleep + steps ---- */
  function recoverySection(A){
    const S=A.sleep, P=A.steps;
    const out={trend:'',theory:'',verdict:''};
    const t=[];

    if(S.daysLogged) {
      t.push('Slept an average of '+S.avg+' hours across '+pl(S.daysLogged,'night')+', with '+S.inBand+' of them ('+S.inBandPct+' %) inside the 7 to 9 hour window'+
             (S.short?(' and '+pl(S.short,'night')+' under 6 hours'):'')+'.');
      if(S.sd!=null) t.push('Night-to-night variation was '+S.sd+' hours.');
      if(S.worst&&S.worst.date&&S.best&&S.best.date) t.push('Shortest night '+f1(S.worst.sleep)+' h on '+fmtDay(S.worst.date)+', longest '+f1(S.best.sleep)+' h on '+fmtDay(S.best.date)+'.');
    } else t.push('No sleep was logged in this block.');

    if(P.daysLogged){
      t.push('Averaged '+kcal(P.avg)+' steps a day over '+pl(P.daysLogged,'day')+' — '+kcal(P.total)+' steps in total — clearing 8,000 on '+
             P.at8k+' of them ('+P.at8kPct+' %)'+(P.under5k?(' and falling under 5,000 on '+pl(P.under5k,'day')):'')+'.');
      if(P.best&&P.best.date) t.push('Best day '+kcal(P.best.steps)+' on '+fmtDay(P.best.date)+'.');
    } else t.push('No step data was logged.');

    const st=A.checkin.stress;
    const stressBits=Object.keys(st).map(k=>st[k]+' '+k);
    if(stressBits.length) t.push('Self-reported stress across check-ins: '+stressBits.join(', ')+'.');
    out.trend=t.join(' ');

    out.theory='Sleep and daily movement are the two levers people discount and then wonder why the plan underperforms. Restricting sleep during a deficit does not slow fat loss much — it changes what you lose, shifting a substantially larger share of the loss to lean tissue while raising hunger and lowering next-day training output (Nedeltcheva 2010). Seven to nine hours is the range where those effects disappear (Hirshkowitz 2015). Steps matter for a different reason: they are unconscious daily energy expenditure, the part of the budget that quietly falls as you diet and as you get lighter, and the benefit curve flattens somewhere around 8,000 to 10,000 a day rather than at the arbitrary 10,000 (Paluch 2022). A step target is not cardio — it is the floor that keeps expenditure from sliding while you eat less.';

    const v=[];
    if(S.avg!=null){
      if(S.avg>=7&&S.avg<=9) v.push('Verdict: sleep is in range at '+S.avg+' hours. Protect it — it is doing quiet work on every other number here.');
      else if(S.avg>=6) v.push('Verdict: at '+S.avg+' hours you are running just under the range. Moving bedtime 30 to 45 minutes earlier is a smaller ask than it sounds and buys back training quality and appetite control.');
      else v.push('Verdict: '+S.avg+' hours is short enough to be actively working against the plan — expect higher hunger, lower gym output and a worse split between fat and muscle lost. This outranks any change to the diet.');
      if(S.sd!=null&&S.sd>=1.5) v.push('Sleep is also inconsistent (±'+S.sd+' h). A fixed wake time does more for that than a fixed bedtime.');
    }
    if(P.avg!=null){
      if(P.avg>=8000) v.push('Steps are at or above the plateau point at '+kcal(P.avg)+' a day. No change needed — hold this even on rest days.');
      else if(P.avg>=7250) v.push('Steps at '+kcal(P.avg)+' a day are effectively at the plateau point — the remaining '+kcal(8000-P.avg)+
        ' is not worth chasing. Consistency matters more here than the last few hundred: it is the low days that pull the average down, not the ceiling.');
      else if(P.avg>=5000) v.push('Steps at '+kcal(P.avg)+' a day leave room: closing to 8,000 is roughly '+kcal(8000-P.avg)+' more, about '+
        Math.round((8000-P.avg)/110)+' minutes of walking, and is worth around '+kcal((8000-P.avg)*0.045)+' kcal a day without touching food.');
      else v.push('Steps at '+kcal(P.avg)+' a day are low enough to be the limiter. Build to 6,000 first, then 8,000 — this is easier to sustain than the equivalent cut in calories.');
    }
    if(A.checkin.highStress>=2) v.push('High stress was reported in '+pl(A.checkin.highStress,'week')+'. Stress does not just feel bad — it suppresses recovery and drives eating that has nothing to do with hunger. Where a block looks inconsistent, this is usually the cause and it should be planned around rather than pushed through.');
    out.verdict=v.join(' ');
    return out;
  }

  /* ---- consistency / adherence ---- */
  function consistencySection(A){
    const out={trend:'',theory:'',verdict:''};
    const t=[];
    t.push('Active on '+A.engagement.activeDays+' of '+A.engagement.totalDays+' days ('+A.engagement.pct+' %), longest unbroken streak '+pl(A.engagement.bestStreak,'day')+'.');
    t.push('Weekly check-ins completed for '+A.checkin.done+' of '+pl(A.meta.weeks,'week')+'.');
    const ol=A.checkin.overload, dt=A.checkin.diet;
    const olMap={improved:'improved',form:'better form',same:'held',regressed:'regressed'};
    const dtMap={met:'on plan',missed_few:'missed a few',binge:'off plan'};
    const olBits=Object.keys(ol).map(k=>ol[k]+' '+(olMap[k]||k));
    const dtBits=Object.keys(dt).map(k=>dt[k]+' '+(dtMap[k]||k));
    if(olBits.length) t.push('Overload self-report: '+olBits.join(', ')+'.');
    if(dtBits.length) t.push('Diet self-report: '+dtBits.join(', ')+'.');
    if(A.score.weeksScored>1&&A.score.best&&A.score.worst){
      t.push('Best week was week '+A.score.best.n+' at '+A.score.best.score+' %, weakest week '+A.score.worst.n+' at '+A.score.worst.score+' %'+
             (A.score.best.range?(' ('+A.score.best.range+' versus '+A.score.worst.range+')'):'')+'.');
    }
    out.trend=t.join(' ');
    out.theory='Consistency is not a personality trait, it is a design problem. Adherence collapses when a plan requires daily willpower, and holds when the default behaviour is already close to correct — the same breakfast, the same training days each week, food logged at the moment of eating rather than reconstructed at midnight. The score in this report is deliberately weighted toward the things you control daily rather than the scale, because the scale is an outcome and those are the inputs.';
    const v=[];
    if(A.engagement.pct>=80) v.push('Verdict: engagement is high. The data behind this report is trustworthy and the conclusions in it can be acted on directly.');
    else if(A.engagement.pct>=50) v.push('Verdict: engagement is partial. Roughly '+(100-A.engagement.pct)+' % of days are invisible to this report, and unlogged days are systematically different from logged ones — assume the real averages are slightly worse than the ones printed here.');
    else v.push('Verdict: most days in this block were not logged. Before changing anything about the plan, spend one week logging everything — the plan is probably not the problem, the visibility is.');
    if(A.checkin.done<A.meta.weeks) v.push('Action: complete the weekly check-in for every week. It is four taps and it is what lets overload, diet and stress enter the score at all.');
    out.verdict=v.join(' ');
    return out;
  }

  /* ---- prioritised action plan ----
     The page this prints on says "ranked by how much it will move the result",
     so it has to actually be ranked. Each candidate carries an impact weight:
     visibility problems first (you cannot coach data you do not have), then the
     levers that move the outcome directly, then the fine-tuning. Where a signal
     lever is available it nudges the base weight, so the ordering reflects THIS
     block rather than a generic opinion. */
  function actionPlan(A){
    const acts=[];
    const N=A.nutrition, W=A.weight, T=A.training, S=A.sleep, P=A.steps;
    const leverOf=key=>{ const s=(A.signals||[]).find(x=>x.key===key); return s?s.lever:0; };

    if(N.proteinPerKg!=null&&N.proteinPerKg<1.6&&N.bodyKg){
      acts.push({impact:85+leverOf('diet'), title:'Raise protein to '+Math.round(1.6*N.bodyKg)+' g a day',
        why:'You are averaging '+N.avgP+' g ('+N.proteinPerKg+' g/kg). Under 1.6 g/kg, more of what you lose comes off as muscle.',
        how:'Add roughly '+Math.round((1.6-N.proteinPerKg)*N.bodyKg)+' g — one palm of meat or fish, or a shake, attached to a meal you already eat.'});
    }
    if(N.coverage!=null&&N.coverage<70){
      acts.push({impact:95, title:'Log food on every day for the next 7 days',
        why:'Only '+N.coverage+' % of days were logged, so every calorie figure in this report describes a filtered week.',
        how:'Log at the moment of eating, not at night. Log the bad days too — those are the ones that explain the trend.'});
    }
    if(T.sessionsPerWeek!=null&&T.sessionsPerWeek<3){
      acts.push({impact:88+leverOf('ol'), title:'Get to three training sessions a week',
        why:'You averaged '+T.sessionsPerWeek+'. Below three, most muscle groups are trained once a week or less, which maintains rather than builds.',
        how:'Fix the days in the calendar now rather than deciding each morning. Three 45-minute sessions beat two long ones.'});
    }
    if(T.stalled.length>=1){
      acts.push({impact:45+leverOf('ol'), title:'Drive '+T.stalled[0].name+' for three sessions',
        why:'Estimated one-rep max has not moved on it across '+pl(T.stalled[0].sessions,'session')+'.',
        how:'Add 2.5 kg or one rep per set each session. If it still will not move after three, drop the load 10 % and rebuild.'});
    }
    // 7,250 not 8,000: the recovery verdict calls anything above that "effectively
    // at the plateau point", and an action plan that contradicts the section it
    // summarises reads as boilerplate — which is what makes clients stop reading.
    if(P.avg!=null&&P.avg<7250){
      acts.push({impact:58+leverOf('steps'), title:'Build daily steps to 8,000',
        why:'You averaged '+kcal(P.avg)+'. Daily movement is the part of expenditure that falls silently while dieting.',
        how:'Add about '+Math.round((8000-P.avg)/110)+' minutes of walking a day — one deliberate walk, same time each day, is easier to keep than scattered movement.'});
    }
    if(S.avg!=null&&S.avg<7){
      acts.push({impact:72+leverOf('sleep'), title:'Get sleep to 7 hours',
        why:'You averaged '+S.avg+' h. Short sleep shifts loss toward lean tissue and raises next-day hunger.',
        how:'Set a fixed wake time first and work bedtime back from it. A consistent 7 beats an erratic 8.'});
    }
    if(W.plateau){
      acts.push({impact:80+leverOf('bw'), title:'Break the plateau in order: movement, then logging, then calories',
        why:'Three consecutive weekly averages inside a 0.4 % band is a genuine stall, not noise.',
        how:'Week 1 restore steps to target. Week 2 log everything with a scale. Only if both hold and weight still has not moved, cut 200 kcal a day.'});
    }
    if(N.weekendDrift!=null&&N.weekendDrift>=300){
      acts.push({impact:78+leverOf('diet'), title:'Close the weekend gap',
        why:'Weekends run '+kcal(N.weekendDrift)+' kcal a day above weekdays, which is roughly '+kcal(N.weekendDrift*2)+' kcal a week.',
        how:'Do not restrict the weekend. Take 150 kcal off each weekday instead and let Saturday stay social.'});
    }
    if(A.checkin.highStress>=2){
      acts.push({impact:65+leverOf('stress'), title:'Plan around stress instead of pushing through it',
        why:'High stress was reported in '+pl(A.checkin.highStress,'week')+'. It suppresses recovery, blunts training output and drives eating that is not hunger.',
        how:'On a known-bad week, cut planned volume by a third rather than skipping training entirely, and hold protein and sleep fixed. A reduced week you complete beats a full week you abandon.'});
    }
    if(A.checkin.done<A.meta.weeks){
      acts.push({impact:40, title:'Complete the weekly check-in every week',
        why:'Only '+A.checkin.done+' of '+A.meta.weeks+' were filled in, and overload, diet and stress cannot score without it.',
        how:'Sunday evening, same time, four taps.'});
    }
    if(!acts.length){
      acts.push({impact:1, title:'Change nothing — repeat this block',
        why:'Every measured signal is inside its target range and the trend is moving with the goal.',
        how:'Run the same plan again and re-read this report in four weeks. Progress is lost far more often to unnecessary changes than to a plan run too long.'});
    }
    // Ranked, then capped at five: a list of ten actions is a list of none.
    return acts.sort((a,b)=>(b.impact||0)-(a.impact||0)).slice(0,5);
  }

  function narrate(A){
    return {
      headline: headline(A),
      weight: weightSection(A),
      training: trainingSection(A),
      nutrition: nutritionSection(A),
      recovery: recoverySection(A),
      consistency: consistencySection(A),
      actions: actionPlan(A)
    };
  }

  return { analyze, narrate, monthPresets, reportName,
           fmtDay, fmtFull, fmtSpan, DLAB, e1rm, mean, slope, r1, f1 };
})();
