function generateNutritionPDF(){
  const jsPDFlib=window.jspdf.jsPDF;
  const dm=getDayMacros(currentDate);
  if(!(dm.cal>0||dm.p>0||dm.c>0||dm.f>0)){ alert('Log some food first.'); return; }

  const doc=new jsPDFlib({orientation:'p',unit:'mm',format:'a4'});
  const W=doc.internal.pageSize.getWidth();   // 210
  const H=doc.internal.pageSize.getHeight();  // 297
  const M=14;
  const CW=W-M*2;

  // Shared palette — IDENTICAL to the training-program PDF
  const RED=[204,0,0], DARK=[17,17,17], GREY=[120,120,120];
  const INK=[21,21,26], SLATE=[74,101,114], GOLD=[198,144,47];
  const MUTE=[148,148,158], LINE=[228,228,232], CARD=[247,247,249];

  const dateLabel=new Date(currentDate+'T12:00:00').toLocaleDateString('en-MY',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  let handle='';
  try{
    const cn=(localStorage.getItem('devfit_displayName')||'').trim();
    handle=cn||(JSON.parse(localStorage.getItem('devfit_user')||'{}').email||'');
  }catch(e){}

  // ---- HEADER (mirrors training program PDF exactly) ----
  function header(first){
    const HH=first?38:20;
    doc.setFillColor(...INK); doc.rect(0,0,W,HH,'F');
    doc.setFillColor(...RED); doc.rect(0,HH,W,1.4,'F');
    // DEVFIT wordmark — bold ITALIC lockup, DEV white + FIT pure red
    doc.setFont('helvetica','bolditalic'); doc.setFontSize(first?23:16);
    const wy=first?14:13;
    doc.setTextColor(255,255,255); doc.text('DEV',M,wy);
    const dW=doc.getTextWidth('DEV');
    doc.setTextColor(...RED); doc.text('FIT',M+dW,wy);
    if(first){
      doc.setFont('helvetica','normal'); doc.setFontSize(6.2); doc.setTextColor(120,120,132);
      doc.text('DOMINANCE THROUGH DISCIPLINE',M,19,{charSpace:0.5});
      // Document title top-right
      doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(255,255,255);
      doc.text('NUTRITION REPORT',W-M,16,{align:'right',charSpace:0.3});
      // subtitle (date · handle)
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(165,165,178);
      const sub=dateLabel+(handle?('   ·   '+handle):'');
      doc.text(sub,W-M,23,{align:'right'});
    } else {
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...MUTE);
      doc.text('NUTRITION REPORT',W-M,13,{align:'right',charSpace:0.6});
    }
  }

  header(true);
  let y=50;
  function ensureSpace(need){ if(y+need>H-20){ doc.addPage(); header(false); y=30; } }

  // ---- CALORIE SUMMARY CARD ----
  const tCal=Number(data.targets.cal)||0;
  const hasTgt=tCal>0;
  const remain=hasTgt?Math.round(tCal-dm.cal):0;
  doc.setFillColor(...CARD); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
  doc.roundedRect(M,y,CW,24,2.5,2.5,'FD');
  doc.setFillColor(...RED); doc.rect(M,y,1.8,24,'F');   // crimson left accent
  doc.setFontSize(23); doc.setFont('helvetica','bold'); doc.setTextColor(...DARK);
  doc.text(dm.cal.toLocaleString(),M+7,y+15);
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...MUTE);
  doc.text('KCAL LOGGED',M+7,y+20,{charSpace:0.4});
  if(hasTgt){
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(80,80,85);
    doc.text('Target  '+tCal.toLocaleString()+' kcal',M+CW/2.6,y+10);
    const rc=remain>=0?[47,159,87]:RED;
    doc.setTextColor(...rc);
    doc.text((remain>=0?'':'+')+Math.abs(remain).toLocaleString()+' kcal '+(remain>=0?'remaining':'over'),M+CW/2.6,y+18);
    const pct=Math.min(1,dm.cal/tCal);
    const fc=dm.cal>tCal?RED:[47,159,87];
    doc.setFillColor(222,222,226); doc.roundedRect(M+CW/2.6,y+20.5,CW-CW/2.6-7,2.6,1,1,'F');
    doc.setFillColor(...fc); doc.roundedRect(M+CW/2.6,y+20.5,(CW-CW/2.6-7)*pct,2.6,1,1,'F');
  }
  y+=30;

  // ---- MACRO TILES (3 side by side) ----
  const macros=[
    {label:'Protein',val:dm.p+'g',tgtStr:Number(data.targets.p)?data.targets.p+'g':'—',col:SLATE},
    {label:'Carbs',  val:dm.c+'g',tgtStr:Number(data.targets.c)?data.targets.c+'g':'—',col:GOLD},
    {label:'Fat',    val:dm.f+'g',tgtStr:Number(data.targets.f)?data.targets.f+'g':'—',col:RED}
  ];
  const mw=(CW-8)/3;
  macros.forEach((mac,i)=>{
    const mx=M+i*(mw+4);
    doc.setFillColor(...CARD); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    doc.roundedRect(mx,y,mw,20,2,2,'FD');
    doc.setFillColor(...mac.col); doc.rect(mx,y,2.4,20,'F');
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(...MUTE);
    doc.text(mac.label.toUpperCase(),mx+6,y+6,{charSpace:0.3});
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...DARK);
    doc.text(mac.val,mx+6,y+15);
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(160,160,165);
    doc.text('/ '+mac.tgtStr,mx+mw-3,y+15,{align:'right'});
  });
  y+=26;

  // ---- MACRO SPLIT BAR ----
  const totMacCal=(dm.p*4)+(dm.c*4)+(dm.f*9);
  if(totMacCal>0){
    let bx=M;
    const segs=[['p',dm.p*4,SLATE],['c',dm.c*4,GOLD],['f',dm.f*9,RED]].filter(s=>s[1]>0);
    segs.forEach(([,v,col],i)=>{
      const sw=CW*(v/totMacCal);
      doc.setFillColor(...col);
      doc.rect(bx,y,i<segs.length-1?Math.max(sw-1,0.5):sw,5,'F');
      bx+=sw;
    });
    y+=8;
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...GREY);
    doc.text('Protein '+Math.round(dm.p*4/totMacCal*100)+'%',M,y);
    doc.text('Carbs '+Math.round(dm.c*4/totMacCal*100)+'%',M+CW/2,y,{align:'center'});
    doc.text('Fat '+Math.round(dm.f*9/totMacCal*100)+'%',M+CW,y,{align:'right'});
    y+=8;
  }
  y+=2;

  // ---- MEALS (each meal = a dark INK card header like training day-cards) ----
  const dayObj=data.days[currentDate];
  const meals=(dayObj&&Array.isArray(dayObj.meals))?dayObj.meals:[];
  const cG=W-M-58, cKcal=W-M-43, cP=W-M-30, cC=W-M-18, cF=W-M-6;
  if(meals.some(m=>m.items&&m.items.length)){
    meals.forEach(meal=>{
      if(!meal.items||!meal.items.length) return;
      ensureSpace(22);
      // meal header bar — dark INK rounded (matches training day-card header)
      const barH=10;
      doc.setFillColor(...INK); doc.roundedRect(M,y,CW,barH,2,2,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(255,255,255);
      doc.text(String(meal.name||'Meal').toUpperCase(),M+5,y+6.6);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(180,180,190);
      doc.text(mealKcal(meal)+' kcal',W-M-4,y+6.6,{align:'right'});
      y+=barH;
      // column header strip
      doc.setFillColor(238,238,241); doc.rect(M,y,CW,6,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...MUTE);
      doc.text('FOOD ITEM',M+5,y+4,{charSpace:0.3});
      doc.text('G',cG,y+4,{align:'right'}); doc.text('KCAL',cKcal,y+4,{align:'right'});
      doc.text('P',cP,y+4,{align:'right'}); doc.text('C',cC,y+4,{align:'right'}); doc.text('F',cF,y+4,{align:'right'});
      y+=6;
      // items
      meal.items.forEach((it,idx)=>{
        ensureSpace(7);
        if(idx%2===1){ doc.setFillColor(250,250,251); doc.rect(M,y,CW,6.4,'F'); }
        doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...DARK);
        const nm=doc.splitTextToSize(String(it.name||''),78)[0];
        doc.text(nm,M+5,y+4.4);
        if(it.grams){ doc.setTextColor(...GREY); doc.setFontSize(8.5); doc.text(String(it.grams),cG,y+4.4,{align:'right'}); }
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...DARK);
        doc.text(String(Math.round(it.cal||0)),cKcal,y+4.4,{align:'right'});
        doc.setFont('helvetica','normal');
        doc.setTextColor(...SLATE); doc.text(String(Math.round(it.p||0)),cP,y+4.4,{align:'right'});
        doc.setTextColor(...GOLD);  doc.text(String(Math.round(it.c||0)),cC,y+4.4,{align:'right'});
        doc.setTextColor(...RED);   doc.text(String(Math.round(it.f||0)),cF,y+4.4,{align:'right'});
        y+=6.4;
      });
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M,y,W-M,y);
      y+=7;
    });

    // ---- TOTAL row (dark INK card, like training) ----
    ensureSpace(12);
    doc.setFillColor(...INK); doc.roundedRect(M,y,CW,9,2,2,'F');
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('DAY TOTAL',M+5,y+6);
    doc.text(dm.cal.toLocaleString()+' kcal',cKcal,y+6,{align:'right'});
    doc.setTextColor(150,180,200); doc.text('P '+dm.p,cP+2,y+6,{align:'right'});
    doc.setTextColor(220,190,120); doc.text('C '+dm.c,cC+1,y+6,{align:'right'});
    doc.setTextColor(255,140,140); doc.text('F '+dm.f,cF,y+6,{align:'right'});
    y+=13;
  }

  // ---- FOOTER on every page (matches training exactly) ----
  const pages=doc.internal.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);
    doc.setDrawColor(230,230,230); doc.setLineWidth(0.3); doc.line(M,H-14,W-M,H-14);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text('Generated by DevFit · Dominance Through Discipline',M,H-9);
    doc.text('Page '+p+' of '+pages,W-M,H-9,{align:'right'});
  }

  // Named download, not doc.save() — see devfit-pdf.js.
  devfitSavePdf(doc, 'DevFit_Nutrition_Report_'+currentDate+'.pdf');
}
