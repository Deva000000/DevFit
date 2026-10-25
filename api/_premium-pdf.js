// Server-only PDF service. Never evaluates client-supplied JavaScript, HTML,
// chart images or file paths. Only authorized account rows feed trusted code.
import fs from 'node:fs';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { sbRpc, clientIp, sha256Hex } from './_lib.js';

const sources = [
  fs.readFileSync(new URL('../progress-model.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('../scoring.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('./_report-engine.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('./_pdf-layout.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('./_pdf-plan.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('./_pdf-nutrition.js', import.meta.url),'utf8'),
  fs.readFileSync(new URL('./_report-pdf.js', import.meta.url),'utf8')
].map((s,i)=>new vm.Script(s,{filename:'trusted-pdf-'+i}));

// Crisp PDF-native charts, independent of CDN, browser canvas and screen size.
function vectorChart(R,A,id,h=40) {
  const rows=A.rows, single=A.meta.single;
  let values=[], labels=[], second=null, target=null, bar=true, unit='', unit2='';
  if(id==='exp-bw') {
    (single&&A.history?A.history.rows:rows).forEach(r=>r.days.forEach(d=>{if(d.bw!=null){values.push(d.bw);labels.push(d.date?.slice(5)||d.label);}}));
    bar=false;unit='kg';
  } else if(id==='exp-vol') {
    values=A.training.perWeekTonnage.map((v,i)=>A.training.perWeek[i]>0?v:null);
    labels=rows.map(r=>'W'+r.n);second=A.training.perWeek;unit='kg volume';unit2='sessions';
  } else if(id==='exp-cal') {
    values=A.nutrition.perWeek.map(r=>r.cal);labels=rows.map(r=>'W'+r.n);target=Number(A.nutrition.target.cal)||null;unit='kcal/day';
  } else if(id==='exp-act') {
    values=single?rows[0].days.map(d=>d.steps):rows.map(r=>r.stepsAvg);
    labels=single?rows[0].days.map(d=>d.label):rows.map(r=>'W'+r.n);
    second=single?rows[0].days.map(d=>d.sleep):rows.map(r=>r.sleepAvg);unit='steps/day';unit2='sleep, h';
  } else {values=rows.map(r=>r.score);labels=rows.map(r=>'W'+r.n);unit='score, %';}
  if(!values.some(v=>v!=null))return;
  R.need(h+9);
  const {pdf,M,CW,S}=R,x=M+13,y=S.y+7,w=CW-28,ph=h-13;
  const valid=values.filter(Number.isFinite),lo=bar?0:Math.min(...valid)-0.15;
  const hi=Math.max(...valid,target||0,lo+0.3)* (bar?1.12:1)+(!bar?0.15:0);
  const Y=v=>y+ph-(v-lo)/(hi-lo)*ph;
  const X=i=>x+w*(i+0.5)/Math.max(1,values.length);
  R.font('normal',6);R.setText(R.MUTE);pdf.text(unit,x,S.y+3);
  if(second)pdf.text(unit2,x+w,S.y+3,{align:'right'});
  for(let i=0;i<=3;i++) {
    const v=lo+(hi-lo)*i/3,gy=Y(v);
    R.setDraw([232,234,238]);pdf.setLineWidth(.2);pdf.line(x,gy,x+w,gy);
    R.setText(R.MUTE);pdf.text(Math.abs(v)<100?v.toFixed(bar?0:1):Math.round(v).toLocaleString('en-US'),x-2,gy+1.8,{align:'right'});
  }
  const draw=(data,YY,color,isBar)=>{
    let last=null;
    data.forEach((v,i)=>{
      if(v==null||!Number.isFinite(v)){last=null;return;}
      const px=X(i),py=YY(v);R.setDraw(color);R.setFill(color);pdf.setLineWidth(.65);
      if(isBar){const bw=Math.min(8,w/values.length*.55);pdf.roundedRect(px-bw/2,py,bw,Math.max(.25,y+ph-py),.7,.7,'F');}
      else{if(last)pdf.line(last[0],last[1],px,py);pdf.circle(px,py,.65,'F');last=[px,py];}
    });
  };
  draw(values,Y,[204,0,0],bar);
  if(target) {R.setDraw([67,72,82]);pdf.setLineDashPattern([1.3,1],0);pdf.line(x,Y(target),x+w,Y(target));pdf.setLineDashPattern([],0);}
  if(second) {
    const max=Math.max(unit2==='sleep, h'?10:1,...second.filter(Number.isFinite))*1.1;
    const YY=v=>y+ph-v/max*ph;draw(second,YY,[74,84,98],false);
    for(let i=0;i<=3;i++)pdf.text((max*i/3).toFixed(unit2==='sleep, h'?1:0),x+w+2,y+ph-ph*i/3+1.8);
  }
  R.setText(R.MUTE);R.font('normal',6);
  labels.forEach((label,i)=>{if(i%Math.max(1,Math.ceil(labels.length/9))===0||i===labels.length-1)pdf.text(String(label),X(i),y+ph+4,{align:'center'});});
  S.y+=h+4;
}

export function renderPremiumPdf(docs, subscriber, action, selection={}) {
  docs=structuredClone(docs);
  let result=null;
  const storage=new Map([
    ['devfit_user',JSON.stringify({email:subscriber.email,name:subscriber.name,startDate:subscriber.start_date})],
    ['devfit_displayName',String(docs.prefs?.devfit_displayName||docs.prefs?.displayName||subscriber.name||'')],
    ['devfitNutritionV2',JSON.stringify(docs.nutrition||{targets:{},days:{}})],
    ['devfitTrainingV1',JSON.stringify(docs.workouts||{plan:{workouts:[]},sessions:[]})]
  ]);
  const save=(pdf,filename)=>{result={filename,bytes:Buffer.from(pdf.output('arraybuffer'))};};
  const context={appData:docs.progress||{}, data:action==='nutrition_pdf'?(docs.nutrition||{targets:{},days:{}}):(docs.workouts||{plan:{workouts:[]},sessions:[]}),
    currentDate:selection.date, jspdf:{jsPDF}, localStorage:{getItem:k=>storage.get(k)||null},
    document:{getElementById:id=>id==='plan-client'?{value:docs.workouts?.plan?.client||''}:null},
    toast(){},alert(message){throw new Error(message);},
    savePdfNamed:save,devfitSavePdf:save,devfitSafeName:s=>String(s||'').replace(/[^a-z0-9]+/gi,'_'),
    safeName:s=>String(s||'').replace(/[^a-z0-9]+/gi,'_'),
    freshCheckin:()=>({}), vectorChart,
    mealKcal:m=>(m.items||[]).reduce((a,i)=>a+(Number(i.cal)||0),0),
    selection
  };
  context.window=context;
  vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});
  sources.forEach(script=>script.runInContext(context,{timeout:5000}));
  new vm.Script(`
    function makeReportDoc(A){const R=makeBaseReportDoc(A);R.chart=(id,h)=>vectorChart(R,A,id,h);return R;}
    function getDayMacros(date){const m=dayMacros(data.days[date]);return m||{cal:0,p:0,c:0,f:0};}
    appData=DevFitProgress.ensureDocument(appData);
    if(selection.programId){
      if(!appData.programs.some(p=>p.id===selection.programId))throw new Error('Program not found');
      appData.activeProgramId=selection.programId;appData=DevFitProgress.applyActive(appData);
    }
  `).runInContext(context,{timeout:5000});
  if(action==='progress_pdf') {
    const {startW,endW}=selection;
    if(!Number.isInteger(startW)||!Number.isInteger(endW)||startW<0||endW<startW||endW-startW>=104
        || endW>=Math.max(context.appData.bw.length,Number(context.appData.programDuration)||0))throw new Error('Choose a valid report range of up to 104 weeks.');
    new vm.Script(`
      var A=DevFitReport.analyze(selection.startW,selection.endW,{});
      if(A.meta.single)A.history=DevFitReport.analyze(0,selection.endW,{});
      DevFitPremiumPDF.paint(A,DevFitReport.summarize(A));
    `).runInContext(context,{timeout:5000});
  } else if(action==='workout_pdf') {
    new vm.Script('exportPlanPDF()').runInContext(context,{timeout:5000});
  } else {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(selection.date||'')||new Date(selection.date).toISOString().slice(0,10)!==selection.date)throw new Error('Choose a valid nutrition date.');
    new vm.Script('generateNutritionPDF()').runInContext(context,{timeout:5000});
  }
  if(!result)throw new Error('No logged data in this selection.');
  if(result.bytes.length>3*1024*1024)throw new Error('Report is too large. Choose a shorter date range.');
  return result;
}

export async function handlePremiumPdf(req,res,email,subscriber,body) {
  const result=await sbRpc('load_devfit_account',{
    p_email:email,p_data_type:null,p_security_context:{deviceId:String(body.deviceId||''),
      ipHash:sha256Hex(clientIp(req)),userAgent:String(req.headers?.['user-agent']||'').slice(0,300)}
  },8000);
  if(!result||result.status!=='ok'){res.status(503).json({error:'report_data_unavailable'});return;}
  const docs=Object.fromEntries((result.rows||[]).map(r=>[r.data_type,r.data]));
  try{
    const pdf=renderPremiumPdf(docs,{...subscriber,email},body.action,body.selection||{});
    res.status(200).json({filename:pdf.filename,pdf:pdf.bytes.toString('base64')});
  }catch(e){res.status(400).json({error:'invalid_report_selection',message:String(e.message).slice(0,150)});}
}
