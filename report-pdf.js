/* DevFit premium progress report renderer
   ---------------------------------------------------------------
   Analysis stays in report-engine.js. This file owns presentation only.
   It deliberately omits charts that cannot show a real trend; missing data
   is reported as a compact state instead of an empty plotting rectangle.
*/
'use strict';

(function(){
  const DARK=[17,19,24], WHITE=[255,255,255], SOFT=[246,247,249], PALE=[235,236,240];

  function paint(A,N){
    const R=makeReportDoc(A);
    const pdf=R.pdf, M=R.M, CW=R.CW, PW=R.PW, S=R.S;
    const clean=v=>String(v==null?'':v).replace(/[\u2013\u2014]/g,'-').replace(/\u00b7/g,' | ').replace(/\u00d7/g,'x');
    const f1=DevFitReport.f1;
    const nf=n=>n==null?null:Math.round(n).toLocaleString();
    const L={}; Object.keys(N.lines||{}).forEach(k=>{ L[k]=clean(N.lines[k]); });
    const focus=(N.focus||[]).map(clean);
    const signalCount=[A.weight.daysLogged,A.training.sessions,A.nutrition.daysLogged,A.sleep.daysLogged,A.steps.daysLogged]
      .filter(v=>v>0).length;

    function metricCards(items,perRow){
      perRow=perRow||3;
      const gap=3,w=(CW-gap*(perRow-1))/perRow,h=21;
      const rows=Math.ceil(items.length/perRow);
      R.need(rows*(h+gap)+2);
      items.forEach((it,i)=>{
        const col=i%perRow,row=Math.floor(i/perRow),x=M+col*(w+gap),y=S.y+row*(h+gap);
        R.setFill(WHITE); pdf.roundedRect(x,y,w,h,2.4,2.4,'F');
        R.setDraw(PALE); pdf.setLineWidth(.35); pdf.roundedRect(x,y,w,h,2.4,2.4,'S');
        R.setFill(it.accent||R.RED); pdf.roundedRect(x,y,1.7,h,1,1,'F');
        R.font('bold',6.5); R.setText(R.MUTE); pdf.text(String(it.label).toUpperCase(),x+5,y+5.5);
        R.font('bold',12); R.setText(R.INK); pdf.text(String(it.value),x+5,y+12.8);
        R.font('normal',6.6); R.setText(R.MUTE); pdf.text(String(it.sub||''),x+5,y+18);
      });
      S.y+=rows*(h+gap)+3;
    }

    function sectionLabel(title,sub){
      R.need(sub?13:9);
      R.font('bold',8); R.setText(R.INK); pdf.text(String(title).toUpperCase(),M,S.y+4);
      R.setFill(R.RED); pdf.roundedRect(M,S.y+6,18,1.1,.5,.5,'F');
      if(sub){ R.font('normal',7.2); R.setText(R.MUTE); pdf.text(String(sub),M+23,S.y+7); S.y+=11; }
      else S.y+=8;
    }

    function insightRows(items){
      items=items.filter(x=>x&&x.text);
      if(!items.length)return;
      const prepared=items.map(it=>({it,lines:pdf.splitTextToSize(String(it.text),CW-43)}));
      const total=prepared.reduce((s,x)=>s+Math.max(8,x.lines.length*4.2+3),0)+4;
      R.need(total);
      R.setFill(SOFT); pdf.roundedRect(M,S.y,CW,total,2.5,2.5,'F');
      let y=S.y+2;
      prepared.forEach((x,i)=>{
        const h=Math.max(8,x.lines.length*4.2+3);
        if(i){ R.setDraw(PALE); pdf.setLineWidth(.25); pdf.line(M+5,y,M+CW-5,y); }
        R.font('bold',7.2); R.setText(x.it.color||R.RED); pdf.text(String(x.it.label).toUpperCase(),M+6,y+5.2);
        R.font('normal',8); R.setText([48,50,58]);
        x.lines.forEach((line,k)=>pdf.text(line,M+41,y+5.2+k*4.2));
        y+=h;
      });
      S.y+=total+4;
    }

    function actionPanel(actions){
      actions=(actions||[]).slice(0,3);
      if(!actions.length)return;
      const rows=actions.map(t=>pdf.splitTextToSize(String(t),CW-24));
      const h=13+rows.reduce((s,l)=>s+Math.max(9,l.length*4.2+2),0)+5;
      R.need(h);
      R.setFill(DARK); pdf.roundedRect(M,S.y,CW,h,3,3,'F');
      R.font('bold',7.2); R.setText([255,110,110]); pdf.text('NEXT ACTIONS',M+7,S.y+7);
      let y=S.y+13;
      rows.forEach((lines,i)=>{
        R.setFill(R.RED); pdf.circle(M+8,y+2.2,2.4,'F');
        R.font('bold',7); R.setText(WHITE); pdf.text(String(i+1),M+8,y+3.2,{align:'center'});
        R.font('normal',8.3); R.setText([236,237,240]);
        lines.forEach((line,k)=>pdf.text(line,M+15,y+3.3+k*4.2));
        y+=Math.max(9,lines.length*4.2+2);
      });
      S.y+=h+4;
    }

    function topicCards(items){
      const gap=4,w=(CW-gap)/2;
      const built=items.map(it=>{
        const lines=pdf.splitTextToSize(String(it.body||''),w-10);
        return {it,lines,h:Math.max(31,21+lines.length*4.1)};
      });
      const h=Math.max.apply(null,built.map(x=>x.h));
      R.need(h+4);
      built.forEach((x,i)=>{
        const xx=M+i*(w+gap),yy=S.y;
        R.setFill(SOFT); pdf.roundedRect(xx,yy,w,h,2.5,2.5,'F');
        R.setFill(x.it.accent||R.RED); pdf.roundedRect(xx,yy,w,1.7,1,1,'F');
        R.font('bold',6.8); R.setText(R.MUTE); pdf.text(String(x.it.title).toUpperCase(),xx+5,yy+7);
        R.font('bold',13); R.setText(R.INK); pdf.text(String(x.it.value),xx+5,yy+15.5);
        R.font('normal',7.4); R.setText([76,78,86]);
        x.lines.forEach((line,k)=>pdf.text(line,xx+5,yy+21+k*4.1));
      });
      S.y+=h+5;
    }

    function trendPanel(title,caption,canvasId,line,h){
      R.need((h||40)+28);
      sectionLabel(title,caption);
      R.chart(canvasId,h||40);
      R.statline(line);
    }

    function dailyTable(row){
      R.table(
        [{h:'Day',w:34},{h:'Weight',w:20,align:'right'},{h:'Steps',w:23,align:'right'},
         {h:'Sleep',w:18,align:'right'},{h:'Calories',w:24,align:'right'},
         {h:'Protein',w:18,align:'right'},{h:'Training',w:45}],
        row.days.map(d=>[
          {t:d.date?DevFitReport.fmtDay(d.date):d.label,bold:true},
          d.bw==null?null:f1(d.bw), d.steps==null?null:nf(d.steps),
          d.sleep==null?null:f1(d.sleep), d.food?nf(d.food.cal):null,
          d.food?(d.food.p+' g'):null,
          d.sessions.length?d.sessions.map(s=>s.workoutName||'Session').join(', '):null
        ]),{rowH:5.7,size:7.1}
      );
    }

    function weeklyDailyTable(row){
      R.table(
        [{h:'Day',w:54},{h:'Weight (kg)',w:43,align:'right'},
         {h:'Steps',w:45,align:'right'},{h:'Sleep (hrs)',w:40,align:'right'}],
        row.days.map(d=>[
          {t:d.date?DevFitReport.fmtDay(d.date):d.label,bold:true},
          d.bw==null?null:f1(d.bw),d.steps==null?null:nf(d.steps),d.sleep==null?null:f1(d.sleep)
        ]),{rowH:6.2,size:7.5}
      );
    }

    function scoreBreakdown(row){
      const order=['bw','bf','ol','diet','sleep','steps','stress'];
      const scores=row.scores||{};
      const items=order.map(key=>scores[key]).filter(Boolean);
      const loggedWeight=items.reduce((sum,s)=>sum+(s.val==null?0:s.weight),0);
      R.need(82);
      R.font('bold',6.5); R.setText(R.MUTE);
      pdf.text('SIGNAL',M,S.y+3.5); pdf.text('SCORE',M+105,S.y+3.5);
      pdf.text('WEIGHT',M+132,S.y+3.5); pdf.text('CONTRIBUTION',PW-M,S.y+3.5,{align:'right'});
      S.y+=6;
      items.forEach((sig,i)=>{
        const h=9,y=S.y;
        if(i%2===0){R.setFill([249,249,251]);pdf.rect(M,y,CW,h,'F');}
        const active=sig.val!=null,c=active?R.scoreColor(sig.val):[174,176,184];
        R.font(active?'bold':'normal',8); R.setText(active?R.INK:[164,166,174]);
        pdf.text(sig.label,M+2,y+5.8);
        const bx=M+40,bw=55;
        R.setFill([229,230,235]); pdf.roundedRect(bx,y+3,bw,3.2,1.1,1.1,'F');
        if(active){R.setFill(c);pdf.roundedRect(bx,y+3,Math.max(1.5,bw*sig.val/100),3.2,1.1,1.1,'F');}
        R.font(active?'bold':'normal',8); R.setText(c);
        pdf.text(active?sig.val+'%':'-',M+105,y+5.8);
        R.font('normal',7.7); R.setText(active?R.BODY:[174,176,184]); pdf.text(sig.weight+'%',M+132,y+5.8);
        R.font(active?'bold':'normal',7.7); R.setText(active?R.INK:[174,176,184]);
        pdf.text(active?Math.round(sig.val*sig.weight/100)+' pts':'-',PW-M-2,y+5.8,{align:'right'});
        R.setDraw(R.LINE);pdf.setLineWidth(.1);pdf.line(M,y+h,PW-M,y+h);
        S.y+=h;
      });
      R.gap(2);
      R.font('normal',7.2);R.setText(R.MUTE);
      const note='Logged signal coverage: '+loggedWeight+'%. Unlogged signals are excluded and available weights are rebalanced.';
      pdf.text(note,M,S.y+3.5);S.y+=7;
    }

    function sessionHeader(sess,continued){
      R.need(10);
      R.setFill([249,239,239]);pdf.roundedRect(M,S.y,CW,8,1.5,1.5,'F');
      R.font('bold',8.5);R.setText([158,0,0]);
      pdf.text(clean(sess.name)+(continued?' (continued)':''),M+4,S.y+5.3);
      R.font('normal',7.3);R.setText(R.MUTE);
      pdf.text(sess.date?DevFitReport.fmtDay(sess.date):'',PW-M-4,S.y+5.3,{align:'right'});
      S.y+=10;
    }

    function detailedSessions(sessions){
      if(!sessions.length){
        R.block('No workouts recorded','No completed training session was saved during this week.',R.SLATE,SOFT);
        return;
      }
      sessions.forEach(sess=>{
        sessionHeader(sess,false);
        if(!sess.exercises.length){R.para('Session saved without exercise details.',{size:8,color:R.MUTE,gap:2});return;}
        sess.exercises.forEach(ex=>{
          const setText=clean((ex.sets||[]).join('  |  '));
          R.font('normal',8);
          const setX=M+62,remarkX=M+138,remarkW=M+CW-remarkX-2;
          const lines=pdf.splitTextToSize(setText,remarkX-setX-4);
          const h=Math.max(7,lines.length*4.2+2.5);
          if(S.y+h>R.BOT){R.newPage('Weekly Record');sessionHeader(sess,true);}
          R.font('bold',8);R.setText(R.INK);pdf.text(clean(ex.name),M+5,S.y+4.6);
          R.font('normal',7.8);R.setText([72,74,82]);
          lines.forEach((line,k)=>pdf.text(line,setX,S.y+4.6+k*4.2));
          const p=ex.progress||null;
          const color=!p?R.SLATE:p.status==='up'?[33,126,70]:p.status==='down'?R.RED:p.status==='flat'?R.GOLD:R.SLATE;
          let result=!p||p.status==='new'?'BASELINE':p.status==='flat'?'STEADY':p.status==='up'?'PROGRESS':'DOWN';
          if(p&&p.changePct!=null&&(p.status==='up'||p.status==='down')){
            const pct=Math.round(p.changePct);result+=' '+(pct>0?'+':'')+pct+'%';
          }
          R.setFill(color);pdf.roundedRect(remarkX,S.y+1.2,remarkW,5.3,2,2,'F');
          R.font('bold',6.2);R.setText(WHITE);pdf.text(result,remarkX+remarkW/2,S.y+4.8,{align:'center'});
          S.y+=h;
        });
        R.gap(2.5);
      });
    }

    function compactSignals(row){
      const order=['bw','bf','ol','diet','sleep','steps','stress'];
      const items=order.map(k=>(row.scores||{})[k]).filter(Boolean);
      const colGap=7,colW=(CW-colGap)/2,rowH=8;
      const rows=Math.ceil(items.length/2);
      R.need(rows*rowH+8);
      items.forEach((sig,i)=>{
        const col=i%2,r=Math.floor(i/2),x=M+col*(colW+colGap),y=S.y+r*rowH;
        const active=sig.val!=null,c=active?R.scoreColor(sig.val):[174,176,184];
        R.font(active?'bold':'normal',7.5);R.setText(active?R.INK:R.MUTE);
        pdf.text(sig.label,x,y+4.8);
        const bx=x+27,bw=colW-45;
        R.setFill([229,230,235]);pdf.roundedRect(bx,y+2.5,bw,2.6,1,1,'F');
        if(active){R.setFill(c);pdf.roundedRect(bx,y+2.5,Math.max(1.2,bw*sig.val/100),2.6,1,1,'F');}
        R.font('bold',7.3);R.setText(c);pdf.text(active?sig.val+'%':'-',x+colW,y+4.8,{align:'right'});
      });
      S.y+=rows*rowH+2;
      const coverage=items.reduce((sum,s)=>sum+(s.val==null?0:s.weight),0);
      R.font('normal',7);R.setText(R.MUTE);
      pdf.text('Score coverage '+coverage+'% - missing signals are excluded and remaining weights are rebalanced.',M,S.y+3.5);
      S.y+=7;
    }

    function summaryColumns(wins,watch){
      const gap=4,w=(CW-gap)/2;
      const groups=[
        {title:'WHAT MOVED FORWARD',items:wins,color:[33,126,70],tint:[241,249,244]},
        {title:'WHAT NEEDS ATTENTION',items:watch,color:R.RED,tint:[253,244,244]}
      ];
      const prepared=groups.map(g=>{
        const items=(g.items||[]).slice(0,3).map(t=>pdf.splitTextToSize(clean(t),w-13));
        if(!items.length)items.push([g===groups[0]
          ? 'No positive trend has enough comparison data yet.'
          : 'No concern is supported by this week\'s data.']);
        return {g,items,h:13+items.reduce((s,l)=>s+Math.max(9,l.length*3.9+3),0)+3};
      });
      const h=Math.max.apply(null,prepared.map(x=>x.h));R.need(h+3);
      prepared.forEach((p,i)=>{
        const x=M+i*(w+gap),y=S.y;
        R.setFill(p.g.tint);pdf.roundedRect(x,y,w,h,2.5,2.5,'F');
        R.setFill(p.g.color);pdf.roundedRect(x,y,w,1.5,1,1,'F');
        R.font('bold',6.8);R.setText(p.g.color);pdf.text(p.g.title,x+5,y+7);
        let yy=y+11;
        p.items.forEach(lines=>{
          R.setFill(p.g.color);pdf.circle(x+5.5,yy+2,1.2,'F');
          R.font('normal',7.3);R.setText([53,55,62]);
          lines.forEach((line,k)=>pdf.text(line,x+9,yy+3+k*3.9));
          yy+=Math.max(9,lines.length*3.9+3);
        });
      });
      S.y+=h+4;
    }

    function weeklyNutrition(row){
      const loggedDays=row.days.filter(d=>d.food).length;
      if(!loggedDays){
        R.need(28);
        sectionLabel('Nutrition this week','Daily macros measured against saved targets');
        R.block('No nutrition recorded','No food entries were saved during this week.',R.RED,SOFT);
        return;
      }
      const daily=A.nutrition.daily||[];
      const adherence=A.nutrition.adherence||{};
      R.need(70);
      sectionLabel('Nutrition this week','Daily macros measured against saved targets');
      R.table(
        [{h:'Day',w:31},{h:'Calories',w:28,align:'right'},{h:'Protein',w:25,align:'right'},
         {h:'Carbs',w:24,align:'right'},{h:'Fat',w:22,align:'right'},{h:'Target result',w:52}],
        row.days.map((d,i)=>{
          const result=daily[i]||{};
          const resultText=result.status==='met'?'Met all targets':result.status==='missed'?'Needs attention':
            result.status==='logged'?'Targets not set':'Not logged';
          const resultColor=result.status==='met'?[33,126,70]:result.status==='missed'?R.RED:R.MUTE;
          return [
          {t:d.date?DevFitReport.fmtDay(d.date):d.label,bold:true},
          d.food?nf(d.food.cal):null,d.food?(nf(d.food.p)+' g'):null,
          d.food?(nf(d.food.c)+' g'):null,d.food?(nf(d.food.f)+' g'):null,
          {t:resultText,bold:result.status==='met'||result.status==='missed',color:resultColor}
        ];}),{rowH:6.1,size:7.1}
      );
      const t=A.nutrition.target||{};
      const targetText=adherence.hasTargets
        ? ['Targets',t.cal?nf(t.cal)+' kcal':null,t.p?t.p+' g protein':null,t.c?t.c+' g carbs':null,t.f?t.f+' g fat':null].filter(Boolean).join('  |  ')
        : 'Macro targets are not set - daily food is preserved but adherence cannot be graded.';
      R.statline(targetText);
      const misses=daily.filter(x=>x.status==='missed');
      if(misses.length){
        sectionLabel('Diet remarks','Exactly where the saved targets were missed');
        insightRows(misses.map(x=>({label:x.date?DevFitReport.fmtDay(x.date):x.label,text:x.remark,color:R.RED})));
      }else if(adherence.hasTargets){
        R.statline(adherence.met+' logged day'+(adherence.met===1?'':'s')+' met every configured target. '+adherence.unlogged+' day'+(adherence.unlogged===1?' was':'s were')+' not logged.');
      }
    }

    function weeklyArchive(){
      const row=A.rows[0],score=row.score;
      R.setFill(R.RED);pdf.rect(0,0,PW,12,'F');
      R.font('bolditalic',18);R.setText(R.INK);pdf.text('DEV',M,28);
      const dw=pdf.getTextWidth('DEV');R.setText(R.RED);pdf.text('FIT',M+dw,28);
      R.font('bold',15);R.setText([48,48,54]);pdf.text(' - Week '+row.n+' Report',M+dw+pdf.getTextWidth('FIT'),28);
      if(window.pdfLogoImg){try{pdf.addImage(window.pdfLogoImg,'PNG',PW-M-13,18,13,13);}catch(e){}}
      R.font('normal',10);R.setText(R.MUTE);pdf.text(String(A.meta.name).toUpperCase(),M,39);
      R.font('normal',8.5);pdf.text(clean(A.meta.span)+'  |  Generated '+A.meta.generated,M,47);
      R.setDraw(R.RED);pdf.setLineWidth(.7);pdf.line(M,52,PW-M,52);
      S.y=58;S.section='Weekly Summary';

      const counts=A.training.progressCounts||{up:0,down:0,flat:0,new:0};
      const adherence=A.nutrition.adherence||{};
      const historyRows=(A.history&&A.history.rows)||[];
      const prevRow=historyRows.find(r=>r.n===row.n-1);
      const weightDelta=(prevRow&&prevRow.bwAvg!=null&&row.bwAvg!=null)?row.bwAvg-prevRow.bwAvg:null;
      const color=score==null?[74,78,88]:R.scoreColor(score),scoreW=43,gap=4,heroH=28;
      R.setFill(color);pdf.roundedRect(M,S.y,scoreW,heroH,3,3,'F');
      R.font('bold',6.3);R.setText([255,242,242]);pdf.text('TRUE PROGRESS',M+6,S.y+6.5);
      R.font('bold',21);R.setText(WHITE);pdf.text(score==null?'--':score+'%',M+6,S.y+18.5);
      R.font('normal',7);pdf.text(score==null?'More data needed':R.scoreGrade(score),M+6,S.y+24);
      const hx=M+scoreW+gap,hw=CW-scoreW-gap;
      R.setFill(DARK);pdf.roundedRect(hx,S.y,hw,heroH,3,3,'F');
      R.font('bold',6.3);R.setText([255,112,112]);pdf.text('THIS WEEK\'S READOUT',hx+7,S.y+6.5);
      let headline='Build the baseline, then beat it.';
      if(counts.up>counts.down&&counts.up)headline='Training momentum moved forward.';
      else if(counts.down>counts.up&&counts.down)headline='Performance needs a recovery check.';
      else if(counts.up&&counts.down)headline='A mixed week - wins and regressions.';
      else if(score!=null&&score>=85)headline='An excellent, well-executed week.';
      R.font('bold',12);R.setText(WHITE);pdf.text(headline,hx+7,S.y+15.5);
      const dietLine=adherence.hasTargets
        ? adherence.met+' target day'+(adherence.met===1?'':'s')+', '+adherence.missed+' missed, '+adherence.unlogged+' unlogged'
        : 'Macro targets not set';
      R.font('normal',7.2);R.setText([198,201,209]);
      pdf.text(counts.up+' exercise'+(counts.up===1?'':'s')+' up  |  '+counts.down+' down  |  '+dietLine,hx+7,S.y+22.5);
      const total=A.meta.programDuration||A.meta.weeks;
      R.font('bold',6.5);R.setText([255,128,128]);pdf.text('WEEK '+row.n+' / '+total,hx+hw-7,S.y+6.5,{align:'right'});
      S.y+=33;

      sectionLabel('At a glance','Four numbers that explain the week');
      metricCards([
        {label:'Average weight',value:row.bwAvg==null?'--':f1(row.bwAvg)+' kg',
         sub:weightDelta==null?row.bwDays+' weigh-ins':((weightDelta>0?'+':'')+f1(weightDelta)+' kg vs Week '+(row.n-1))},
        {label:'Training',value:A.training.sessions+' session'+(A.training.sessions===1?'':'s'),sub:A.training.tonnage?nf(A.training.tonnage)+' kg volume':'No volume recorded'},
        {label:'Exercise progress',value:counts.up+' up / '+counts.down+' down',sub:counts.flat+' steady  |  '+counts.new+' baseline',accent:[45,122,88]},
        {label:'Diet targets',value:adherence.hasTargets?(A.nutrition.daysLogged?(adherence.met+' / '+A.nutrition.daysLogged):'No days logged'):'Not set',
         sub:adherence.hasTargets?'logged days met all targets':'Set in Nutrition',accent:[116,72,170]}
      ],4);

      const wins=(A.training.exerciseProgress||[]).filter(x=>x.status==='up').slice(0,2).map(x=>x.name+': '+x.remark);
      if(adherence.hasTargets&&adherence.met)wins.push(adherence.met+' logged diet day'+(adherence.met===1?'':'s')+' met every configured target.');
      if(!wins.length&&row.sleepAvg>=7)wins.push('Sleep averaged '+f1(row.sleepAvg)+' hours - inside the 7-9 hour recovery range.');
      const watch=(A.training.exerciseProgress||[]).filter(x=>x.status==='down').slice(0,2).map(x=>x.name+': '+x.remark);
      (A.nutrition.daily||[]).filter(x=>x.status==='missed').slice(0,2).forEach(x=>watch.push((x.date?DevFitReport.fmtDay(x.date):x.label)+': '+x.remark));
      if(!watch.length&&focus.length)watch.push(focus[0]);
      summaryColumns(wins,watch);

      sectionLabel('Score contributors','Compact transparency - not a decorative score bar');
      compactSignals(row);

      R.page('Weekly Record',clean(A.meta.span));
      const history=A.history||A;
      if(history.weight.daysLogged>=2){
        trendPanel('Bodyweight history','Program trend through Week '+row.n,'exp-bw',L.weight,43);
      }
      sectionLabel('Daily log','Bodyweight, steps and sleep for all seven days');
      weeklyDailyTable(row);
      R.need(16);sectionLabel('Workouts this week','Every exercise, completed set and progress remark');
      detailedSessions(A.training.list);
      if(A.training.list.length&&A.nutrition.daysLogged)R.page('Nutrition Review',clean(A.meta.span));
      weeklyNutrition(row);
      if(A.checkin.notes.length){
        R.need(25);sectionLabel('Weekly notes');
        A.checkin.notes.forEach(note=>R.block('Week '+note.n,clean(note.text),R.SLATE,[244,245,247]));
      }
    }

    function finish(){
      R.footers();
      const fname='DevFit_'+A.meta.fileBase+'_'+safeName(A.meta.name)+'.pdf';
      savePdfNamed(pdf,fname);
      toast(A.meta.title+' saved');
    }

    function cover(){
      R.setFill(DARK); pdf.rect(0,0,PW,63,'F');
      R.setFill(R.RED); pdf.rect(0,0,5,63,'F');
      R.font('bolditalic',17); R.setText(WHITE); pdf.text('DEV',M,20);
      const dw=pdf.getTextWidth('DEV'); R.setText([255,62,62]); pdf.text('FIT',M+dw,20);
      R.font('bold',7); R.setText([255,105,105]); pdf.text('PERFORMANCE REPORT',PW-M,18,{align:'right'});
      if(window.pdfLogoImg){ try{ pdf.addImage(window.pdfLogoImg,'PNG',PW-M-13,23,13,13); }catch(e){} }
      R.font('bold',18); R.setText(WHITE); pdf.text(A.meta.title,M,36);
      R.font('normal',9); R.setText([215,217,222]); pdf.text(String(A.meta.name).toUpperCase(),M,44);
      R.font('normal',8); R.setText([158,162,172]);
      pdf.text([clean(A.meta.span)||'Program dates unavailable',A.meta.goalLabel,A.meta.calendarDays+' days'].join('  |  '),M,51);
      pdf.text('Generated '+A.meta.generated,M,57);
      S.y=68; S.section='Executive Summary';

      const left=57,gap=4,right=CW-left-gap,h=36;
      const score=A.score.avg;
      R.setFill(score==null?[47,50,58]:R.scoreColor(score)); pdf.roundedRect(M,S.y,left,h,3,3,'F');
      R.font('bold',6.8); R.setText([255,238,238]); pdf.text('TRUE PROGRESS SCORE',M+6,S.y+7);
      R.font('bold',24); R.setText(WHITE); pdf.text(score==null?'--':score+'%',M+6,S.y+22);
      R.font('normal',8); pdf.text(score==null?'More data needed':A.score.grade,M+6,S.y+29.5);

      const rx=M+left+gap;
      R.setFill(SOFT); pdf.roundedRect(rx,S.y,right,h,3,3,'F');
      R.font('bold',6.8); R.setText(R.MUTE); pdf.text('DATA CONFIDENCE',rx+7,S.y+7);
      R.font('bold',14); R.setText(R.INK); pdf.text(A.engagement.activeDays+' / '+A.engagement.totalDays+' active days',rx+7,S.y+17);
      R.font('normal',7.5); R.setText(R.MUTE);
      pdf.text(signalCount+' of 5 data areas recorded',rx+7,S.y+24);
      pdf.text('Longest logging streak: '+A.engagement.bestStreak+' day'+(A.engagement.bestStreak===1?'':'s'),rx+7,S.y+30);
      R.setFill([222,224,229]); pdf.roundedRect(rx+7,S.y+31.5,right-14,2.2,1,1,'F');
      R.setFill(R.RED); pdf.roundedRect(rx+7,S.y+31.5,(right-14)*(A.engagement.pct/100),2.2,1,1,'F');
      S.y+=42;
    }

    // Weekly exports are detailed archives by design: score maths, the complete
    // seven-day log, every workout set and daily nutrition. Multi-week exports
    // remain trend-led analytics reports.
    if(A.meta.single){
      weeklyArchive();
      finish();
      return pdf;
    }

    cover();
    metricCards([
      {label:A.meta.single?'Average weight':'Weight change',
       value:A.weight.change==null?(A.weight.last==null?'--':f1(A.weight.last)+' kg'):((A.weight.change>0?'+':'')+f1(A.weight.change)+' kg'),
       sub:A.weight.daysLogged+' weigh-ins'},
      {label:'Training',value:A.training.sessions+' session'+(A.training.sessions===1?'':'s'),sub:A.training.tonnage?nf(A.training.tonnage)+' kg volume':'No volume recorded'},
      {label:'Nutrition',value:A.nutrition.avgCal==null?'--':nf(A.nutrition.avgCal)+' kcal',sub:A.nutrition.daysLogged+' days logged'},
      {label:'Protein',value:A.nutrition.avgP==null?'--':A.nutrition.avgP+' g',sub:A.nutrition.proteinPerKg?A.nutrition.proteinPerKg+' g/kg':'Daily average'},
      {label:'Sleep',value:A.sleep.avg==null?'--':A.sleep.avg+' h',sub:A.sleep.daysLogged+' nights logged',accent:[116,72,170]},
      {label:'Steps',value:A.steps.avg==null?'--':nf(A.steps.avg),sub:A.steps.daysLogged+' days logged',accent:[45,122,88]}
    ]);

    sectionLabel('Performance readout','Only conclusions supported by this report period');
    insightRows([
      {label:'Weight',text:L.weight}, {label:'Training',text:L.training},
      {label:'Nutrition',text:L.nutrition}, {label:'Recovery',text:L.recovery},
    ]);
    R.need(57);
    sectionLabel('Priority plan');
    actionPanel(focus);

    if(!A.meta.anchored){
      R.block('Dates need attention','Set a program start date on the Progress page so training and nutrition can be matched to this report.',R.ORANGE,[255,248,235]);
    }

    if(A.meta.single){
      const row=A.rows[0];
      R.page('Week Dashboard',clean(A.meta.span));
      if(A.weight.daysLogged>=2) trendPanel('Bodyweight','Daily movement across the selected week','exp-bw',L.weight,34);

      sectionLabel('Daily record','A complete seven-day view - blanks were not logged');
      dailyTable(row);

      if(A.sleep.daysLogged>=2||A.steps.daysLogged>=2){
        trendPanel('Recovery and movement','Bars are steps; red line is sleep','exp-act',L.recovery,31);
      }

      R.need(45);
      sectionLabel('Training and nutrition');
      topicCards([
        {title:'Training',value:A.training.sessions?A.training.sessions+' session'+(A.training.sessions===1?'':'s'):'Not logged',
         body:A.training.sessions?(nf(A.training.tonnage)+' kg total volume. '+A.training.hardSets+' working sets.'):'No completed training session was recorded this week.'},
        {title:'Nutrition',value:A.nutrition.daysLogged?A.nutrition.daysLogged+' / 7 days':'Not logged',
         body:A.nutrition.daysLogged?(nf(A.nutrition.avgCal)+' kcal and '+A.nutrition.avgP+' g protein per logged day.'):'No food entries were recorded this week.'}
      ]);
      if(L.lifts){ sectionLabel('Strength movement'); R.statline(L.lifts); }
    }else{
      R.page('Performance Trends',clean(A.meta.span));
      let trends=0;
      if(A.weight.daysLogged>=2){ trendPanel('Bodyweight','Daily weigh-ins across the selected period','exp-bw',L.weight,42); trends++; }
      if(A.training.sessions>0){ trendPanel('Training load','Bars are weekly volume; line is sessions','exp-vol',L.training,40); trends++; }
      if(A.nutrition.daysLogged>0){ trendPanel('Nutrition adherence','Weekly calorie average; dashed line is target','exp-cal',L.nutrition,40); trends++; }
      if(A.sleep.daysLogged>=2||A.steps.daysLogged>=2){ trendPanel('Recovery and movement','Bars are steps; red line is sleep','exp-act',L.recovery,40); trends++; }
      if(A.score.weeksScored>=2){ trendPanel('True Progress Score','Comparable weekly signal scores','exp-score',L.score,38); trends++; }
      if(!trends){
        R.block('Build your trend','This period does not yet contain enough repeated entries for a reliable chart. The tables below still preserve every logged value.',R.SLATE,SOFT);
      }
      if(L.lifts){ sectionLabel('Strength movement'); R.statline(L.lifts); }

      R.page('Week by Week','Comparable weekly totals and averages');
      R.table(
        [{h:'Week',w:16},{h:'Dates',w:40},{h:'Weight',w:19,align:'right'},
         {h:'Steps',w:19,align:'right'},{h:'Sleep',w:15,align:'right'},
         {h:'Sessions',w:17,align:'right'},{h:'Volume kg',w:21,align:'right'},
         {h:'Avg kcal',w:19,align:'right'},{h:'Score',w:16,align:'right'}],
        A.rows.map((r,i)=>{
          const line=[{t:'W'+r.n,bold:true},clean(r.range),r.bwAvg==null?null:f1(r.bwAvg),
            r.stepsAvg==null?null:nf(r.stepsAvg),r.sleepAvg==null?null:f1(r.sleepAvg),
            String(A.training.perWeek[i]),A.training.perWeekTonnage[i]?nf(A.training.perWeekTonnage[i]):null,
            A.nutrition.perWeek[i].cal==null?null:nf(A.nutrition.perWeek[i].cal),
            r.score==null?null:{t:r.score+'%',bold:true,color:R.scoreColor(r.score)}];
          if(r.score!=null)line._accent=R.scoreColor(r.score);
          return line;
        }),{rowH:6.8}
      );

      R.page('Daily Log','Every recorded value in the selected period');
      A.rows.forEach(r=>{
        R.need(58);
        R.setFill(DARK); pdf.roundedRect(M,S.y,CW,7,1.5,1.5,'F');
        R.font('bold',8); R.setText(WHITE); pdf.text('Week '+r.n,M+3,S.y+4.9);
        R.font('normal',7.5); R.setText([210,212,218]); pdf.text(clean(r.range)||'no dates',M+26,S.y+4.9);
        if(r.score!=null){ R.font('bold',8); R.setText(WHITE); pdf.text(r.score+'%',PW-M-3,S.y+4.9,{align:'right'}); }
        S.y+=8.5; dailyTable(r);
      });
    }

    if(A.training.list.length){
      R.page('Training Log','Completed sessions and the strongest set from each');
      R.table(
        [{h:'Date',w:32},{h:'Session',w:34},{h:'Sets',w:14,align:'right'},
         {h:'Volume kg',w:24,align:'right'},{h:'Cardio',w:22,align:'right'},
         {h:'Heaviest set',w:56}],
        A.training.list.map(sess=>{
          let top=null;
          sess.exercises.forEach(ex=>{ if(ex.bestE1rm!=null&&(!top||ex.bestE1rm>top.bestE1rm))top=ex; });
          const strengthSet=top?top.sets.find(x=>/x|\u00d7/.test(x)):null;
          return [{t:sess.date?DevFitReport.fmtDay(sess.date):null,bold:true},sess.name,sess.sets||null,
            sess.tonnage?nf(sess.tonnage):null,sess.min?(sess.min+' min'):null,
            top?clean(top.name+'  '+(strengthSet||'')):null];
        }),{rowH:6.2,size:7.3}
      );
    }

    if(A.checkin.notes.length){
      R.page('Check-in Notes','Notes saved during the selected period');
      A.checkin.notes.forEach(note=>R.block('Week '+note.n+(note.range?(' - '+clean(note.range)):''),clean(note.text),R.SLATE,[244,245,247]));
    }

    finish();
    return pdf;
  }

  window.DevFitPremiumPDF={paint};
})();
