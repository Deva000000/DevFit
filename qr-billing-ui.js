(function(){'use strict';
// ---------- PAYMENT RECEIPTS ----------
const qrOwner=DevFitAuth.getUser().email;
var pendingPaymentImage='';
var paymentCatalog=[];
var paymentBaseReference='';
var paymentOwnerWhatsapp='60183679177';
function paymentAmount(cents){return 'RM'+(Number(cents||0)/100).toFixed(2);}
function selectedPaymentOffer(){return paymentCatalog.find(function(x){return x.code===document.getElementById('qr-payment-offer').value;})||null;}
function updatePaymentOffer(){
  var selected=selectedPaymentOffer(),base=paymentBaseReference;
  var codes={app_pro:'APP',coaching_4w:'C4',coaching_8w:'C8',coaching_12w:'C12',coaching_student_4w:'STU4'};
  document.getElementById('qr-payment-reference').textContent=base?base.replace(/_APP$/,'_'+(codes[document.getElementById('qr-payment-offer').value]||'APP')):'Loading…';
  document.getElementById('qr-payment-offer-summary').innerHTML=selected?
    '<strong>'+paymentEscape(selected.label)+'</strong> · <b>'+paymentEscape(paymentAmount(selected.amountCents))+'</b><br>'+(selected.code==='coaching_student_4w'?'Confirm student eligibility with DevFit before paying. ':'')+'Receipt review and activation are handled by DevFit.':
    'The current price is unavailable. Please wait and retry before paying.';
}
function paymentToken(){try{return DevFitAuth.getToken()||'';}catch(e){return '';}}
function paymentDate(value){try{return new Date(value).toLocaleString('en-MY',{dateStyle:'medium',timeStyle:'short'});}catch(e){return '—';}}
function paymentEscape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function paintPaymentHistory(rows){
  var box=document.getElementById('qr-payment-history-list'); if(!box)return;
  if(!rows||!rows.length){box.innerHTML='<div class="card-sub">No receipts submitted yet.</div>';return;}
  box.innerHTML=rows.map(function(p){
    var status=String(p.status||'pending');
    var label=status==='verified'?'Verified':status==='rejected'?'Needs attention':'Under review';
    var offer=paymentCatalog.find(function(x){return x.code===p.offer_code;});
    return '<div class="qr-payment-history-item"><div class="ref">'+paymentEscape((offer&&offer.label)||p.reference||'DevFit payment')+'</div>'+
      '<div class="status '+status+'">'+label+'</div><div class="when">'+paymentEscape(paymentDate(p.uploaded_at))+' · '+Math.max(1,Math.round((p.byte_size||0)/1024))+' KB</div></div>';
  }).join('');
}
async function paymentRequest(op,payload){
  if(DevFitAuth.getUser().email!==qrOwner)throw Error('Account changed. Reopen Billing.');
  var token=paymentToken(); if(!token)throw new Error('Sign in again to continue.');
  var body=Object.assign({op:op,deviceId:localStorage.getItem('devfit_device_id')||'unknown'},payload||{});
  var res=await fetch('/api/data',{method:'POST',cache:'no-store',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  var data=await res.json().catch(function(){return {};});
  if(DevFitAuth.getUser().email!==qrOwner)throw Error('Account changed. Reopen Billing.');
  if(!res.ok){
    if(data.error==='student_approval_required')throw Error('Student pricing requires DevFit approval before payment. Contact DevFit to verify your eligibility.');
    if(data.error==='student_verification_unavailable')throw Error('Student eligibility could not be checked. Do not pay yet; please retry or contact DevFit.');
    var messages={invalid_image:'Choose a valid JPG, PNG or WebP screenshot.',image_too_large:'The compressed receipt is still too large.',invalid_offer:'Choose a valid payment option.',invalid_payment_details:'Enter your name and WhatsApp number.',email_mismatch:'Use the Gmail connected to this DevFit account.',receipt_already_used_for_another_offer:'This screenshot is already attached to another package. Upload the receipt for this payment.',upload_limit_reached:'Upload limit reached. Contact DevFit if you need help.',payment_settings_unavailable:'Current payment prices are unavailable. Please do not pay yet; retry shortly.',receipt_storage_unavailable:'Receipt storage is temporarily unavailable.',payment_save_failed:'The receipt could not be saved. Please retry.'};
    throw new Error(messages[data.error]||'Payment service is temporarily unavailable.');
  }
  return data;
}
async function loadPaymentHistory(){
  try{
    var data=await paymentRequest('paymentHistory');
    paymentCatalog=data.offers||[];
    var choices=document.getElementById('qr-payment-offer');choices.textContent='';
    paymentCatalog.forEach(function(offer){var option=document.createElement('option');option.value=offer.code;option.textContent=offer.label+' · '+paymentAmount(offer.amountCents);choices.appendChild(option);});
    paymentBaseReference=data.reference||'';
    paymentOwnerWhatsapp=String(data.ownerWhatsapp||'60183679177').replace(/\D/g,'');
    var user=JSON.parse(localStorage.getItem('devfit_user')||'{}');
    document.getElementById('qr-payment-payer-email').value=data.email||'';
    if(!document.getElementById('qr-payment-payer-name').value)document.getElementById('qr-payment-payer-name').value=user.name||'';
    if(!document.getElementById('qr-payment-payer-whatsapp').value)document.getElementById('qr-payment-payer-whatsapp').value=localStorage.getItem('devfit_payment_whatsapp')||'';
    var saved=localStorage.getItem('devfit_selected_offer');
    if(saved&&paymentCatalog.some(function(x){return x.code===saved;}))document.getElementById('qr-payment-offer').value=saved;
    updatePaymentOffer();
    paintPaymentHistory(data.payments||[]);
    fetch('/api/config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(cfg){if(cfg&&cfg.qr)document.getElementById('qr-payment-qr').src=cfg.qr;}).catch(function(){});
  }catch(e){
    var box=document.getElementById('qr-payment-history-list');if(box)box.textContent=e.message;
    var ref=document.getElementById('qr-payment-reference');if(ref)ref.textContent='Unavailable';
  }
}
function canvasBlob(canvas,quality){return new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',quality);});}
function readAsDataUrl(blob){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result);};r.onerror=reject;r.readAsDataURL(blob);});}
function loadReceiptImage(file){return new Promise(function(resolve,reject){
  var url=URL.createObjectURL(file),img=new Image();
  img.onload=function(){URL.revokeObjectURL(url);resolve(img);};
  img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('That file is not a readable image.'));};img.src=url;
});}
async function compressPaymentProof(file){
  if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type)||file.size>15*1024*1024)throw new Error('Choose a JPG, PNG or WebP image under 15 MB.');
  var img=await loadReceiptImage(file),limits=[1200,1050,900,760],qualities=[.78,.68,.58,.5],blob=null;
  for(var i=0;i<limits.length;i++){
    var scale=Math.min(1,limits[i]/Math.max(img.naturalWidth,img.naturalHeight));
    var c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
    var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
    blob=await canvasBlob(c,qualities[i]);if(blob&&blob.size<=450000)break;
  }
  if(!blob||blob.size>450000)throw new Error('This screenshot could not be compressed enough. Crop it to the payment details and try again.');
  return {data:await readAsDataUrl(blob),bytes:blob.size};
}
async function choosePaymentProof(event){
  var file=event.target.files&&event.target.files[0];event.target.value='';if(!file)return;
  var status=document.getElementById('qr-payment-proof-file-status'),submit=document.getElementById('submit-qr-payment-proof');
  pendingPaymentImage='';submit.disabled=true;status.textContent='Preparing a small secure copy…';
  try{var packed=await compressPaymentProof(file);pendingPaymentImage=packed.data;submit.disabled=false;status.textContent='Ready to submit · '+Math.max(1,Math.round(packed.bytes/1024))+' KB. The full image is not kept on this page.';}
  catch(e){status.textContent=e.message;toast(e.message,true);}
}
async function submitPaymentProof(){
  if(!pendingPaymentImage)return;
  var btn=document.getElementById('submit-qr-payment-proof'),status=document.getElementById('qr-payment-proof-file-status');
  var offer=selectedPaymentOffer(),name=document.getElementById('qr-payment-payer-name').value.trim(),phone=document.getElementById('qr-payment-payer-whatsapp').value.trim();
  if(!offer){toast('Wait for the current price to load, then retry.',true);return;}
  if(name.length<2||!/^\+?[0-9\s()-]{7,22}$/.test(phone)||phone.replace(/\D/g,'').length<7){toast('Enter your name and a valid WhatsApp number.',true);return;}
  btn.disabled=true;btn.textContent='Submitting…';
  try{
    var data=await paymentRequest('submitPayment',{image:pendingPaymentImage,offerCode:offer.code,payerName:name,payerWhatsApp:phone,payerEmail:document.getElementById('qr-payment-payer-email').value});
    pendingPaymentImage='';localStorage.setItem('devfit_payment_whatsapp',phone);
    status.textContent=data.duplicate?'This receipt was already submitted.':'Receipt saved privately. DevFit will check the payment before activating access.';
    toast('Payment receipt submitted ✓');
    if(!data.duplicate&&data.payment){
      var message=['Hi DevFit, I submitted a payment receipt for review.','Package: '+offer.label,'Listed price: '+paymentAmount(offer.amountCents),'Name: '+name,'Gmail: '+document.getElementById('qr-payment-payer-email').value,'Receipt ID: '+data.payment.id,'I understand activation follows your review.'].join('\n');
      var link=document.getElementById('qr-payment-whatsapp-followup');
      link.href='https://wa.me/'+paymentOwnerWhatsapp+'?text='+encodeURIComponent(message);link.hidden=false;
      document.getElementById('qr-payment-whatsapp-note').hidden=false;
    }
    await loadPaymentHistory();
  }catch(e){btn.disabled=false;status.textContent=e.message;toast(e.message,true);}
  finally{btn.textContent='Submit receipt';}
}
document.getElementById('choose-qr-payment-proof').addEventListener('click',function(){document.getElementById('qr-payment-proof-file').click();});
document.getElementById('qr-payment-proof-file').addEventListener('change',choosePaymentProof);
document.getElementById('submit-qr-payment-proof').addEventListener('click',submitPaymentProof);
document.getElementById('copy-qr-payment-reference').addEventListener('click',async function(){
  var value=document.getElementById('qr-payment-reference').textContent;
  try{await navigator.clipboard.writeText(value);toast('Payment reference copied ✓');}catch(e){prompt('Copy your payment reference:',value);}
});
document.getElementById('qr-payment-offer').addEventListener('change',function(){localStorage.setItem('devfit_selected_offer',this.value);updatePaymentOffer();});
loadPaymentHistory();


})();
