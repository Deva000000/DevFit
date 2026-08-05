/* DevFit — PDF save helper (shared)
   ------------------------------------------------------------------
   Why this exists: jsPDF's own doc.save() hands off to a bundled FileSaver
   whose Safari / iOS branch does `popup.location.href = blobURL`. There is no
   filename in that path, so the browser names the download after the blob's
   UUID and the client ends up with "3f9c1b2e-7a44-....pdf" instead of the
   report they asked for. Every export in the app routes through here instead,
   so the name we choose is the name that lands on the device.

   Load order does not matter — nothing here runs until it is called.
*/
'use strict';

// Turn any label into something safe for a filename, without collapsing it to
// nothing: "Week 1 to Week 5" -> "Week_1_to_Week_5".
function devfitSafeName(s){
  return String(s||'').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'');
}

// Save a jsPDF document under an exact filename.
//   pdf      — the jsPDF instance
//   filename — including the .pdf extension
//   opts     — { share:true } to offer the native share sheet first on mobile
//              (used by the workout-program export, which people send on)
function devfitSavePdf(pdf, filename, opts){
  opts = opts || {};
  if(!filename) filename = 'DevFit.pdf';

  let blob;
  try{ blob = pdf.output('blob'); }
  catch(e){ try{ pdf.save(filename); }catch(_){} return; }

  // Share-first is opt-in: on desktop canShare is false so this is a no-op,
  // and on mobile the share sheet's "Save to Files" keeps the filename intact.
  if(opts.share){
    try{
      const file = new File([blob], filename, {type:'application/pdf'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        navigator.share(Object.assign({files:[file], title:opts.title||filename}, opts.shareExtra||{}))
          .catch(()=>devfitDownloadBlob(blob, filename, pdf));
        return;
      }
    }catch(e){}
  }

  devfitDownloadBlob(blob, filename, pdf);
}

function devfitDownloadBlob(blob, filename, pdfForFallback){
  try{ if(navigator.msSaveOrOpenBlob){ navigator.msSaveOrOpenBlob(blob, filename); return; } }catch(e){}

  try{
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;      // the whole point — this is what names the file
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revoke late: some mobile browsers finish writing the file after the click
    // returns, and pulling the URL out from under them produces a 0-byte save.
    setTimeout(()=>{ try{ a.remove(); URL.revokeObjectURL(url); }catch(e){} }, 6000);
    return;
  }catch(e){}

  // Anchor downloads refused outright (older iOS standalone PWAs) — the share
  // sheet is the only remaining route that preserves a filename.
  try{
    const file = new File([blob], filename, {type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      navigator.share({files:[file], title:filename}).catch(()=>{ if(pdfForFallback) pdfForFallback.save(filename); });
      return;
    }
  }catch(e){}

  try{ if(pdfForFallback) pdfForFallback.save(filename); }catch(e){}
}
