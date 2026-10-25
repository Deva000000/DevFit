function exportPlanPDF(){
  const jsPDFlib=window.jspdf.jsPDF;
  const workouts=(data.plan.workouts||[]).filter(w=>w.name || (w.exercises&&w.exercises.length));
  if(!workouts.length){ toast('Add at least one workout first'); return; }

  const doc=new jsPDFlib({orientation:'p',unit:'mm',format:'a4'});
  const W=doc.internal.pageSize.getWidth();   // 210
  const H=doc.internal.pageSize.getHeight();  // 297
  const M=14;                                  // margin
  const RED=[204,0,0], DARK=[17,17,17], GREY=[120,120,120], LIGHT=[245,245,247];
  const progName=(data.plan.name||'Workout Program').trim();
  const client=(document.getElementById('plan-client').value||'').trim();
  const notes=(data.plan.notes||'').trim();
  const dateStr=new Date().toLocaleDateString('en-MY',{day:'2-digit',month:'long',year:'numeric'});

  // ============ PREMIUM DASHBOARD LAYOUT ============
  const INK=[21,21,26], SLATE=[74,101,114], GOLD=[198,144,47];
  const MUTE=[148,148,158], LINE=[228,228,232], CARD=[247,247,249];

  // ---- HEADER ----
  function header(first){
    const HH=first?38:20;
    doc.setFillColor(...INK); doc.rect(0,0,W,HH,'F');
    doc.setFillColor(...RED); doc.rect(0,HH,W,1.4,'F');
    // DEVFIT wordmark — EXACT logo lockup (bold ITALIC), +20% size
    doc.setFont('helvetica','bolditalic'); doc.setFontSize(first?23:16);
    const wy=first?14:13;
    doc.setTextColor(255,255,255); doc.text('DEV',M,wy);
    const dW=doc.getTextWidth('DEV');
    doc.setTextColor(...RED); doc.text('FIT',M+dW,wy);
    if(first){
      doc.setFont('helvetica','normal'); doc.setFontSize(6.2); doc.setTextColor(120,120,132);
      doc.text('DOMINANCE THROUGH DISCIPLINE',M,19,{charSpace:0.5});
      // WORKOUT PROGRAM = the document title (readable)
      doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(255,255,255);
      doc.text('WORKOUT PROGRAM',W-M,16,{align:'right',charSpace:0.3});
      // program name kept SMALL as a subtitle (no date)
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(165,165,178);
      const sub=progName+(client?('   ·   '+client):'');
      doc.text(sub,W-M,23,{align:'right'});
    } else {
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...MUTE);
      doc.text('WORKOUT PROGRAM',W-M,13,{align:'right',charSpace:0.6});
    }
  }

  header(true);
  let y=50;

  // ---- DAY CARDS ----
  function ensureSpace(need){
    if(y+need>H-20){ doc.addPage(); header(false); y=30; }
  }

  workouts.forEach((w,wi)=>{
    const exs=w.exercises.filter(e=>e.name);
    ensureSpace(26);

    // day header bar (dark, rounded) with crimson number badge
    const barH=11;
    doc.setFillColor(...INK); doc.roundedRect(M,y,W-M*2,barH,2,2,'F');
    doc.setFillColor(...RED); doc.roundedRect(M+3,y+2.4,7,7,1.4,1.4,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(255,255,255);
    doc.text(String(wi+1),M+6.5,y+7.4,{align:'center'});
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
    doc.text((w.name||('Workout '+(wi+1))).toUpperCase(),M+14,y+7.3);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(180,180,190);
    doc.text(exs.length+' exercises',W-M-4,y+7.3,{align:'right'});
    y+=barH;

    // table header
    const cName=M+5, cSets=W-M-44, cReps=W-M-20;
    doc.setFillColor(238,238,241); doc.rect(M,y,W-M*2,6.5,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTE);
    doc.text('EXERCISE',cName,y+4.4,{charSpace:0.4});
    doc.text('SETS',cSets,y+4.4,{charSpace:0.4});
    doc.text('REPS',cReps,y+4.4,{charSpace:0.4});
    y+=6.5;

    // rows
    if(!exs.length){
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTE);
      doc.text('No exercises added.',cName,y+5); y+=8;
    }
    exs.forEach((ex,i)=>{
      ensureSpace(7.6);
      if(i%2===1){ doc.setFillColor(250,250,251); doc.rect(M,y,W-M*2,7.6,'F'); }
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
      const name=ex.name.length>50?ex.name.slice(0,48)+'…':ex.name;
      doc.text(name,cName,y+5.1);
      doc.setFont('helvetica','bold'); doc.setTextColor(...RED);
      doc.text(String(ex.tSets||'—'),cSets,y+5.1);
      doc.setTextColor(...SLATE);
      doc.text(String(ex.tReps||'—'),cReps,y+5.1);
      y+=7.6;
    });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M,y,W-M,y);
    y+=9;
  });

  // ---- NOTES ----
  if(notes){
    const lines=doc.splitTextToSize(notes,W-M*2-12);
    ensureSpace(16+lines.length*5);
    const boxH=14+lines.length*5;
    doc.setFillColor(252,248,248); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    doc.roundedRect(M,y,W-M*2,boxH,2.5,2.5,'FD');
    doc.setFillColor(...RED); doc.rect(M,y,1.6,boxH,'F');   // crimson left accent
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...RED);
    doc.text('COACH NOTES',M+6,y+7,{charSpace:0.5});
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(70,70,75);
    doc.text(lines,M+6,y+13);
    y+=boxH+8;
  }

  // ---- FOOTER on every page ----
  const pages=doc.internal.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);
    doc.setDrawColor(230,230,230); doc.line(M,H-14,W-M,H-14);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text('Generated by DevFit · Dominance Through Discipline',M,H-9);
    doc.text('Page '+p+' of '+pages,W-M,H-9,{align:'right'});
  }

  // Real name, not a blob UUID — share sheet first because a program PDF is
  // usually sent on to someone. See devfit-pdf.js.
  const fname='DevFit_'+(devfitSafeName(progName)||'Workout')+'_Program.pdf';
  devfitSavePdf(doc, fname, {share:true, title:progName,
                             shareExtra:{text:'DevFit workout program'}});
  toast('PDF saved as '+fname);
}
