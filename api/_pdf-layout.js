function makeBaseReportDoc(A){
  const { jsPDF } = window.jspdf;
  // compress:true matters here — this report embeds four chart bitmaps and runs
  // to a dozen pages. Uncompressed it lands around 4.5 MB, which is a hostile
  // download on mobile data; deflated it is a fraction of that.
  const pdf = new jsPDF({orientation:'p', unit:'mm', format:'a4', compress:true});
  const PW=210, PH=297, M=14, CW=PW-M*2, TOP=18, BOT=274;

  const RED=[204,0,0], INK=[24,24,26], BODY=[64,64,70], MUTE=[135,135,143],
        LINE=[226,226,232], WASH=[247,247,249], SLATE=[74,84,98],
        GREEN=[45,122,58], GOLD=[168,124,10], ORANGE=[196,84,0];

  const S={ y:TOP, section:'' };

  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setText=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const font=(st,sz)=>{ pdf.setFont('helvetica',st); pdf.setFontSize(sz); };

  function scoreColor(v){ return v>=85?GREEN : v>=65?GOLD : v>=40?ORANGE : RED; }
  function scoreGrade(v){ return v>=85?'Excellent' : v>=65?'Good' : v>=40?'Fair' : 'Needs Work'; }

  function runningHead(){
    setFill(RED); pdf.rect(0,0,PW,7,'F');
    font('bold',7); setText([255,255,255]);
    pdf.text('DEVFIT  -  '+String(A.meta.name).toUpperCase(), M, 4.8);
    font('normal',7); setText([255,208,208]);
    pdf.text(String(S.section||'').toUpperCase(), PW-M, 4.8, {align:'right'});
  }
  function newPage(section){
    pdf.addPage();
    if(section!=null) S.section=section;
    runningHead();
    S.y=TOP;
  }
  function need(h){ if(S.y+h>BOT) newPage(); }
  function gap(h){ S.y+=(h==null?4:h); }

  function page(title, kicker){
    if(S.y>TOP+2) newPage(title); else S.section=title;
    font('bold',16); setText(INK);
    pdf.text(title, M, S.y+6);
    if(kicker){
      font('normal',8.5); setText(MUTE);
      pdf.text(kicker, M, S.y+12);
      S.y+=16;
    } else S.y+=11;
    setDraw(RED); pdf.setLineWidth(0.7); pdf.line(M,S.y,M+26,S.y);
    setDraw(LINE); pdf.setLineWidth(0.3); pdf.line(M+26,S.y,PW-M,S.y);
    S.y+=6;
  }

  function slab(txt){
    need(9);
    font('bold',7); setText(MUTE);
    pdf.text(String(txt).toUpperCase(), M, S.y+3.5);
    S.y+=6;
  }

  function para(text, o){
    o=o||{};
    if(!text) return;
    const size=o.size||9, lh=o.lh||4.6, x=M+(o.indent||0);
    font(o.style||'normal', size);
    const lines=pdf.splitTextToSize(String(text), CW-(o.indent||0));
    lines.forEach(ln=>{
      need(lh+0.5);
      font(o.style||'normal', size); setText(o.color||BODY);
      pdf.text(ln, x, S.y+lh*0.72);
      S.y+=lh;
    });
    gap(o.gap==null?3:o.gap);
  }

  // Kicker + body inside a tinted card with a coloured spine. Falls back to a
  // ruled flow when the text is taller than a whole page, so nothing is clipped.
  function block(kicker, text, accent, tint){
    if(!text) return;
    accent=accent||SLATE; tint=tint||WASH;
    font('normal',9);
    const lines=pdf.splitTextToSize(String(text), CW-16);
    const h=lines.length*4.7 + (kicker?7:0) + 9;

    if(h<=(BOT-TOP) && S.y+h>BOT) newPage();

    if(S.y+h<=BOT){
      setFill(tint); pdf.roundedRect(M,S.y,CW,h,2,2,'F');
      setFill(accent); pdf.rect(M,S.y,2.2,h,'F');
      let ty=S.y+6.5;
      if(kicker){ font('bold',7); setText(accent); pdf.text(String(kicker).toUpperCase(),M+8,ty); ty+=6.5; }
      font('normal',9); setText(BODY);
      lines.forEach(l=>{ pdf.text(l,M+8,ty); ty+=4.7; });
      S.y+=h+4.5;
    } else {
      if(kicker){ need(8); font('bold',7); setText(accent); pdf.text(String(kicker).toUpperCase(),M+8,S.y+4); S.y+=7; }
      lines.forEach(l=>{
        need(5);
        setFill(accent); pdf.rect(M,S.y-0.5,2.2,5.2,'F');
        font('normal',9); setText(BODY);
        pdf.text(l,M+8,S.y+3.3);
        S.y+=4.7;
      });
      gap(4.5);
    }
  }

  // The one line that sits under a chart. Wraps if it has to, but it is written
  // upstream to fit — see the note at the top of report-engine.js about why this
  // replaced three paragraphs of coaching per section.
  function statline(text){
    if(!text) return;
    need(9);
    setFill([245,245,248]); pdf.roundedRect(M,S.y,CW,0.1,0,0,'F');
    font('bold',8.2);
    const lines=pdf.splitTextToSize(String(text), CW-6);
    const h=lines.length*4.9+4;
    setFill([248,248,250]); pdf.roundedRect(M,S.y,CW,h,1.5,1.5,'F');
    setFill(RED); pdf.rect(M,S.y,2,h,'F');
    setText([48,48,56]);
    lines.forEach((l,i)=>pdf.text(l, M+6, S.y+5.4+i*4.9));
    S.y+=h+5;
  }

  function kpis(items, perRow){
    perRow=perRow||4;
    const rowsN=Math.ceil(items.length/perRow);
    const w=(CW-(perRow-1)*3)/perRow, h=21;
    need(rowsN*(h+3));
    items.forEach((k,i)=>{
      const col=i%perRow, row=Math.floor(i/perRow);
      const x=M+col*(w+3), yy=S.y+row*(h+3);
      if(k.accent){
        setFill(k.accent); pdf.roundedRect(x,yy,w,h,2,2,'F');
        font('bold',6.5); setText([255,255,255]); pdf.text(String(k.lbl).toUpperCase(),x+3.5,yy+5.5);
        font('bold',13); pdf.text(String(k.val),x+3.5,yy+13.5);
        font('normal',6.5); pdf.text(String(k.sub||''),x+3.5,yy+18.5);
      } else {
        setFill(WASH); pdf.roundedRect(x,yy,w,h,2,2,'F');
        font('bold',6.5); setText(MUTE); pdf.text(String(k.lbl).toUpperCase(),x+3.5,yy+5.5);
        font('bold',13); setText(INK); pdf.text(String(k.val),x+3.5,yy+13.5);
        font('normal',6.5); setText(MUTE); pdf.text(String(k.sub||''),x+3.5,yy+18.5);
      }
    });
    S.y+=rowsN*(h+3)+3;
  }

  // cols: [{h, w, align}]   rows: [[cell | {t,color,bold}]]  (row._accent draws a spine)
  function table(cols, rows, o){
    o=o||{};
    const rh=o.rowH||6.4, hh=7.4;
    function header(){
      need(hh+rh);
      setFill([32,32,38]); pdf.rect(M,S.y,CW,hh,'F');
      font('bold',7); setText([255,255,255]);
      let x=M;
      cols.forEach(c=>{
        const tx=c.align==='right' ? x+c.w-2 : x+2;
        pdf.text(String(c.h), tx, S.y+5, c.align==='right'?{align:'right'}:undefined);
        x+=c.w;
      });
      S.y+=hh;
    }
    header();
    rows.forEach((r,i)=>{
      if(S.y+rh>BOT){ newPage(); header(); }
      if(i%2===0){ setFill([249,249,251]); pdf.rect(M,S.y,CW,rh,'F'); }
      if(r._accent){ setFill(r._accent); pdf.rect(M,S.y,1.8,rh,'F'); }
      let x=M;
      cols.forEach((c,ci)=>{
        const cell=r[ci];
        const obj=(cell&&typeof cell==='object')?cell:{t:cell};
        const txt=(obj.t==null||obj.t==='')?'-':String(obj.t);
        font(obj.bold?'bold':'normal', o.size||7.6);
        setText(obj.color || (txt==='-'?[176,176,182]:[52,52,58]));
        const tx=c.align==='right' ? x+c.w-2 : x+2;
        pdf.text(txt, tx, S.y+rh*0.68, c.align==='right'?{align:'right'}:undefined);
        x+=c.w;
      });
      setDraw(LINE); pdf.setLineWidth(0.1); pdf.line(M,S.y+rh,PW-M,S.y+rh);
      S.y+=rh;
    });
    gap(4);
  }

  function chart(canvasId, h, caption){
    const cv=document.getElementById(canvasId);
    if(!cv) return;
    h=h||58;
    need(h+(caption?7:0)+2);
    try{ pdf.addImage(cv.toDataURL('image/png'),'PNG',M,S.y,CW,h); }catch(e){ return; }
    S.y+=h+1.5;
    if(caption){ font('italic',7); setText(MUTE); pdf.text(caption,M,S.y+3); S.y+=6; }
    gap(2);
  }

  // Where the score actually comes from, weakest first — that is the end you act on.
  function signalBars(sigs){
    if(!sigs || !sigs.length) return;
    const xBar=M+38, barW=82, xVal=xBar+barW+4, xWt=PW-M;
    need(6);
    font('bold',6.5); setText(MUTE);
    pdf.text('SIGNAL', M, S.y+3);
    pdf.text('AVERAGE', xVal, S.y+3);
    pdf.text('WEIGHT IN SCORE', xWt, S.y+3, {align:'right'});
    S.y+=5.5;
    sigs.forEach(s=>{
      need(8.5);
      const c=scoreColor(s.avg);
      font('bold',8); setText([40,40,46]);
      pdf.text(s.label, M, S.y+4.4);
      setFill([231,231,237]); pdf.roundedRect(xBar,S.y+1.6,barW,3.6,1.2,1.2,'F');
      setFill(c); pdf.roundedRect(xBar,S.y+1.6,Math.max(1.5,barW*(s.avg/100)),3.6,1.2,1.2,'F');
      font('bold',8); setText(c);
      pdf.text(s.avg+'%', xVal, S.y+4.4);
      font('normal',7.5); setText(MUTE);
      pdf.text(s.weight+'%', xWt, S.y+4.4, {align:'right'});
      S.y+=7.6;
    });
    gap(3);
  }

  function footers(){
    const pages=pdf.getNumberOfPages();
    for(let p=1;p<=pages;p++){
      pdf.setPage(p);
      setFill(RED); pdf.rect(0,PH-10,PW,10,'F');
      font('normal',7.5); setText([255,255,255]);
      pdf.text('DevFit - Dominance Through Discipline - '+A.meta.title, M, PH-3.6);
      setText([255,205,205]);
      pdf.text('Page '+p+' of '+pages+'  -  devfitportal.vercel.app', PW-M, PH-3.6, {align:'right'});
    }
  }

  return { pdf, PW, PH, M, CW, TOP, BOT, S,
           RED, INK, BODY, MUTE, LINE, WASH, SLATE, GREEN, GOLD, ORANGE,
           setFill, setText, setDraw, font, scoreColor, scoreGrade,
           newPage, need, gap, page, slab, para, block, statline,
           kpis, table, chart, signalBars, footers, runningHead };
}
