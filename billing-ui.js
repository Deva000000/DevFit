/* One-time checkout. This UI cannot grant access; only verified server records can. */
(function(){'use strict';
  const $=id=>document.getElementById(id),owner=DevFitAuth.getUser().email;
  let offers=[],enabled=false,busy=false;
  const money=n=>'RM'+(Number(n)/100).toFixed(2);
  const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sameAccount(){return DevFitAuth.getUser().email===owner;}
  async function request(op,extra){
    if(!sameAccount())throw Error('Account changed. Reopen Billing.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch('/api/data',{method:'POST',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+DevFitAuth.getToken()},
        body:JSON.stringify({op,deviceId:localStorage.getItem('devfit_device_id'),...extra})});
      const data=await r.json();if(!sameAccount())throw Error('Account changed. Reopen Billing.');
      if(!r.ok){const messages={checkout_not_configured:'Online payments are not available yet. Please try again later.',checkout_expired:'This checkout has expired. Please start a new payment.',checkout_already_used:'This payment attempt is already complete. Refresh payment history.',invalid_contact:'Enter your full name and a valid contact number.',payment_confirmation_pending:'Your payment is still being confirmed. Do not pay again; refresh its status shortly.',checkout_busy:'Please wait a minute before retrying.'};
        const e=new Error(data.error==='payment_review_required'?'A refunded or disputed payment needs DevFit review before another purchase. Please contact support.':messages[data.error]||'Payment service is temporarily unavailable. Please retry.');e.code=data.error;throw e;}
      return data;
    }finally{clearTimeout(timer);}
  }
  function selection(){
    const offer=offers.find(o=>o.code===$('payment-offer').value);
    $('billing-price').textContent=offer?offer.label+' · '+money(offer.amountCents):'Choose a plan';
    $('billing-pay').textContent=offer?'Pay '+money(offer.amountCents)+' securely':'Continue to secure payment';
    $('billing-pay').disabled=!enabled||!offer||busy;
  }
  async function invoice(id){
    try{const result=await request('paymentInvoice',{orderId:id}),bytes=Uint8Array.from(atob(result.pdf),c=>c.charCodeAt(0));
      window.devfitDownloadBlob(new Blob([bytes],{type:'application/pdf'}),result.filename);
    }catch(e){$('billing-result').textContent=e.message;}
  }
  function history(rows){
    const box=$('billing-history-list');box.textContent='';
    if(!rows.length){box.textContent='No online payments yet. Previous receipt records remain available to DevFit support.';return;}
    rows.forEach(p=>{
      const row=document.createElement('div');row.className='payment-history-item';
      row.innerHTML='<div class="ref">'+esc(p.label)+'</div><div>'+money(p.amountCents)+' · '+esc(p.test?'Test payment':p.status)+'</div><div class="when">'+esc(new Date(p.paidAt||p.createdAt).toLocaleString('en-MY',{dateStyle:'medium',timeStyle:'short'}))+(p.accessEnd?' · Pro through '+esc(p.accessEnd):'')+'</div>';
      if(p.status==='paid'){const b=document.createElement('button');b.type='button';b.textContent='Download invoice';b.onclick=()=>invoice(p.id);row.appendChild(b);}
      box.appendChild(row);
    });
  }
  async function load(){
    try{const data=await request('billingHistory');enabled=data.enabled;offers=data.offers||[];
      const previous=$('payment-offer').value;$('payment-offer').textContent='';
      offers.forEach(o=>{const option=document.createElement('option');option.value=o.code;option.textContent=o.label+' · '+money(o.amountCents);$('payment-offer').appendChild(option);});
      if(offers.some(o=>o.code===previous))$('payment-offer').value=previous;
      $('billing-email').value=data.email;$('billing-name').value=$('billing-name').value||DevFitAuth.getUser().name||'';
      history(data.orders||[]);selection();
      if(!enabled)$('billing-result').textContent='Online payments are being set up. No payment can be taken yet.';
      else if(data.test)$('billing-result').textContent='TEST MODE: no real money is charged and Pro is not activated.';
      const renew=$('renew-btn');renew.href='#payment-checkout';renew.textContent=DevFitAuth.isPro()?'Renew Pro':'Upgrade to Pro';
    }catch(e){$('billing-result').textContent=e.message;$('billing-pay').disabled=true;}
  }
  async function pay(){
    if(busy||!enabled)return;busy=true;selection();$('billing-result').textContent='Preparing secure checkout…';
    const key='devfit_checkout_request::'+owner+'::'+$('payment-offer').value;
    try{
      let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id);}
      const data=await request('createCheckout',{offerCode:$('payment-offer').value,requestId:id,name:$('billing-name').value,phone:$('billing-phone').value});
      const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Invalid checkout response. Please retry.');
      location.assign(url.href);
    }catch(e){if(['checkout_expired','checkout_already_used'].includes(e.code))sessionStorage.removeItem(key);$('billing-result').textContent=e.message;busy=false;selection();}
  }
  async function confirm(){
    const params=new URLSearchParams(location.search),id=params.get('payment_order');
    if(!id){if(params.has('payment_cancelled'))$('billing-result').textContent='Checkout cancelled. No access was changed.';return;}
    $('billing-result').textContent='Confirming payment. Please do not pay again.';
    try{
      const data=await request('checkoutStatus',{orderId:id});
      if(data.order.status!=='paid'){$('billing-result').textContent='Payment is still pending. Refresh here shortly; access will update when Stripe confirms payment.';return;}
      sessionStorage.removeItem('devfit_checkout_request::'+owner+'::'+data.order.offerCode);
      await DevFitAuth.reverify();await load();$('billing-result').textContent=data.order.test?'Test payment confirmed. No real charge or Pro activation.':'Payment confirmed. Pro is active through '+data.order.accessEnd+'. Your invoice is in payment history.';
      window.history.replaceState(null,'','settings.html#billing');$('billing-history').open=true;
    }catch(e){$('billing-result').textContent=e.message;}
  }
  $('billing-pay').onclick=pay;$('payment-offer').onchange=selection;
  $('billing-method').onchange=function(){
    const qr=this.value==='qr';$('stripe-method-panel').hidden=qr;$('qr-method-panel').hidden=!qr;
  };
  $('billing-refresh').onclick=async()=>{await load();await confirm();};
  load().then(confirm);
})();
