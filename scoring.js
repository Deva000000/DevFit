/* DevFit — shared scoring engine (single source of truth)
   Loaded by index.html (the app) AND settings.html (PDF reports) so the score
   shown in-app is ALWAYS identical to the score printed on the report.
   Do NOT re-inline these functions in any page — that's what caused the app
   vs report drift this file was created to kill.

   All functions read the page-global `appData` / `freshCheckin` at call time,
   so script order doesn't matter as long as this loads before they're called.

   Evidence base:
   • Steps — benefit plateaus ~8,000–10,000/day (Paluch 2022, Lancet Public
     Health; Saint-Maurice 2020, JAMA).
   • Sleep — 7–9 h optimal (Hirshkowitz 2015, Sleep Health).
   • Bodyweight rate — loss 0.5–1.0 %BW/wk spares lean mass (Helms 2014, JISSN;
     Garthe 2011); lean gain 0.25–0.5 %BW/wk (Aragon & Schoenfeld 2013); maintain ±0.5 %BW/wk.
*/
'use strict';

// Null-safe by contract. Callers index a week out of appData.bw / steps / sleep,
// and that index can legitimately point past the end: the Free tier collapses the
// arrays to a single week, report ranges are built from programDuration rather
// than from the arrays, and a stale currentWeek survives a tier change. Reading
// .filter off undefined threw and took the whole render down with it — a blank
// page, not a wrong number. "No data for that week" is null, never a crash.
function avg(arr){
  if(!Array.isArray(arr)) return null;
  const n = arr.filter(v=>v!=='').map(Number).filter(n=>!isNaN(n)&&n>0);
  return n.length ? n.reduce((a,b)=>a+b,0)/n.length : null;
}
function loggedValues(arr){
  if(!Array.isArray(arr)) return [];
  return arr.filter(v=>v!==''&&v!==null&&v!==undefined).map(Number).filter(n=>Number.isFinite(n)&&n>0);
}
function median(arr){
  const n=loggedValues(arr).sort((a,b)=>a-b);
  if(!n.length) return null;
  const m=Math.floor(n.length/2);
  return n.length%2?n[m]:(n[m-1]+n[m])/2;
}

function stepsScore(s,target){
  if(s===null) return null;
  let goal=Number(target);
  if(!Number.isFinite(goal)||goal<3000) goal=Number(typeof appData!=='undefined'&&appData&&appData.targetSteps)||7000;
  goal=Math.max(3000,Math.min(goal,20000));
  const ratio=s/goal;
  if(ratio>=1)    return 100;
  if(ratio>=0.85) return 85;
  if(ratio>=0.70) return 65;
  if(ratio>=0.50) return 40;
  return 20;
}
function sleepScore(h){
  if(h===null) return null;
  if(h>=7 && h<=9)  return 100;
  if(h>9 && h<=10)  return 85;
  if(h>=6 && h<7)   return 75;
  if(h>10)          return 65;
  if(h>=5 && h<6)   return 45;
  return 20;
}
function overloadScore(ol){
  if(ol==='improved')  return 100;
  if(ol==='form')      return 75;
  if(ol==='same')      return 60;
  if(ol==='regressed') return 30;
  return null;
}
function bfScore(dir){
  if(dir==='drop_clear')  return 100;
  if(dir==='drop_slight') return 85;
  if(dir==='same')        return 60;
  if(dir==='rise_slight') return 35;
  if(dir==='rise_clear')  return 10;
  return null;
}
function dietScore(d){ if(d==='met') return 100; if(d==='missed_few') return 70; if(d==='binge') return 25; return null; }
function stressScore(s){ if(s==='low') return 100; if(s==='moderate') return 55; if(s==='high') return 30; return null; }

// Bodyweight rate-of-change scoring (% change vs previous logged week).
function bwScore(bwAvg, prevBwAvg, goalType, weekIndex, currentCount, previousCount){
  if(weekIndex===0) return null; // Week 1 is baseline — no score yet
  if((currentCount||0)<3 || (previousCount||0)<3) return null; // daily noise needs a real weekly sample
  if(bwAvg===null || prevBwAvg===null) return null;
  const pct=(bwAvg-prevBwAvg)/prevBwAvg*100;
  const tw=appData.goal?parseFloat(appData.goal):null;
  if(tw!==null){
    if(goalType==='loss'&&bwAvg<=tw) return 100;
    if(goalType==='gain'&&bwAvg>=tw) return 100;
    if(goalType==='maintain'&&Math.abs(bwAvg-tw)<=0.25) return 100;
  }
  if(goalType==='loss'){
    if(pct<=-0.5 && pct>=-1.0) return 100; // ideal 0.5–1%/wk (lean-mass sparing)
    if(pct<-1.0)               return 65;  // too aggressive — muscle-loss risk
    if(pct<-0.25)              return 88;  // 0.25–0.5%/wk — safe, slightly slow
    if(pct<0)                  return 72;  // <0.25%/wk — losing but very slow
    if(pct<=0.25)              return 45;  // essentially flat
    return 20;                             // gaining (wrong direction)
  }
  if(goalType==='gain'){
    if(pct>=0.25 && pct<=0.5)  return 100; // ideal lean gain 0.25–0.5%/wk
    if(pct>0.5 && pct<=1.0)    return 80;  // acceptable (more fat for non-novices)
    if(pct>1.0)                return 55;  // too fast — excess fat gain
    if(pct>0)                  return 70;  // <0.25%/wk — gaining slowly
    if(pct>=-0.25)             return 45;  // essentially flat
    return 20;                             // losing (wrong direction)
  }
  // maintain — stability around current weight
  if(Math.abs(pct)<=0.5)   return 100;
  if(Math.abs(pct)<=1.0)   return 70;
  if(Math.abs(pct)<=1.5)   return 45;
  return 25;
}

// The DevFit true-progress score — 7 weighted signals, adaptive normalisation,
// recomp credit, and target-reached overrides. Returns {overall, scores, totalWeight}.
function calcTrueScore(w){
  // Every container is optional too — a half-built appData (fresh install, a
  // restore mid-flight) must degrade to "nothing logged", not explode.
  const ci=(appData.weeklyCheckin||[])[w]||freshCheckin();
  const currentBw=loggedValues((appData.bw||[])[w]);
  const bwAvg=median(currentBw);
  let prevBwAvg=null;
  let previousCount=0;
  for(let pw=w-1;pw>=0;pw--){ const pv=loggedValues((appData.bw||[])[pw]); if(pv.length>=3){prevBwAvg=median(pv);previousCount=pv.length;break;} }
  const stepsAvg=avg((appData.steps||[])[w]);
  const sleepAvg=avg((appData.sleep||[])[w]);
  const gt=appData.goalType||'loss';
  const tw=appData.goal?parseFloat(appData.goal):null;

  let bwVal=bwScore(bwAvg,prevBwAvg,gt,w,currentBw.length,previousCount);
  let bfVal=bfScore(ci.bfDir);
  let bwStatus='';
  if(bwVal===null){
    if(currentBw.length===0) bwStatus='Not logged';
    else if(currentBw.length<3) bwStatus='Need 3 weigh-ins';
    else if(w===0) bwStatus='Baseline week';
    else if(previousCount<3) bwStatus='Need previous baseline';
  }

  // Recomp credit — scale stalled but body-fat dropping = working
  const bfDropping=(ci.bfDir==='drop_clear'||ci.bfDir==='drop_slight');
  if(bfDropping && bwVal!==null && bwVal<75) bwVal=75;

  // Target reached overrides
  const targetReached = bwAvg!==null && tw!==null && (
    (gt==='loss'&&bwAvg<=tw) ||
    (gt==='gain'&&bwAvg>=tw) ||
    (gt==='maintain'&&Math.abs(bwAvg-tw)<=0.5)
  );
  if(targetReached) bwVal=100;
  if(targetReached && bfDropping) bfVal=100;

  const scores={
    bw:     {val:bwVal,                          weight:17, label:'Bodyweight', status:bwStatus},
    bf:     {val:bfVal,                          weight:10, label:'Body fat'},
    ol:     {val:overloadScore(ci.overload),     weight:22, label:'Overload'},
    diet:   {val:dietScore(ci.diet),             weight:23, label:'Diet'},
    sleep:  {val:sleepScore(sleepAvg),           weight:10, label:'Sleep'},
    steps:  {val:stepsScore(stepsAvg,appData.targetSteps), weight:10, label:'Steps'},
    stress: {val:stressScore(ci.stress),         weight:8,  label:'Stress'}
  };

  // Adaptive normalisation — only weight what's actually logged
  let totalWeight=0, weightedSum=0, signalCount=0;
  Object.values(scores).forEach(s=>{
    if(s.val!==null){ totalWeight+=s.weight; weightedSum+=s.val*s.weight; signalCount++; }
  });

  // Sparse lifestyle-only data must never look like a complete weekly result.
  // Require three independent signals covering at least 40% of the product
  // weighting before presenting one headline number; components remain visible.
  const overall = signalCount>=3 && totalWeight>=40 ? Math.round(weightedSum/totalWeight) : null;
  const coverage=Math.round(totalWeight);
  const confidence=coverage>=70?'High':coverage>=40?'Moderate':'Low';

  return {overall, scores, totalWeight, signalCount, coverage, confidence};
}
