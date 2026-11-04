import Stripe from 'stripe';
import crypto from 'node:crypto';
import { sbSelect,sbInsertIgnore,sbPatch,sbRpc,rateLimit,sha256Hex } from './_lib.js';
import { paymentOffers } from './_payments.js';

export function stripeConfig() {
  const key=process.env.STRIPE_SECRET_KEY||'',mode=process.env.STRIPE_MODE||'test';
  const valid=['test','live'].includes(mode)&&new RegExp('^(sk|rk)_'+mode+'_').test(key);
  return {key,mode,live:mode==='live',configured:valid&&!!process.env.STRIPE_WEBHOOK_SECRET,ready:valid&&!!process.env.STRIPE_WEBHOOK_SECRET
    &&process.env.DEVFIT_STRIPE_ENABLED==='true'};
}
export function stripeClient() { return new Stripe(stripeConfig().key,{maxNetworkRetries:1,timeout:12000,httpClient:Stripe.createFetchHttpClient()}); }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validOrderId(id) { return UUID.test(String(id||'')); }
export function publicOrder(row) {
  return {id:row.id,offerCode:row.offer_code,label:row.offer_label,amountCents:row.amount_cents,
    currency:row.currency,status:row.status,paidAt:row.paid_at,createdAt:row.created_at,
    accessStart:row.access_start,accessEnd:row.access_end,test:!row.livemode};
}
export async function orderForAccount(email,id) {
  if(!validOrderId(id))return null;
  const rows=await sbSelect('devfit_checkout_orders','id=eq.'+id+'&email=eq.'+encodeURIComponent(email)+'&limit=1');
  return rows===null?undefined:rows[0]||null;
}
export async function reconcileCheckout(order,client=stripeClient()) {
  if(!order?.stripe_session_id)return {status:'pending'};
  // Never trust a success URL, customer-entered billing email, or webhook body
  // for amount/account identity. Retrieve canonical objects using our own key.
  const s=await client.checkout.sessions.retrieve(order.stripe_session_id,{expand:['payment_intent.latest_charge']});
  if(s.id!==order.stripe_session_id||s.client_reference_id!==order.id||s.metadata?.devfit_order!==order.id
    ||s.metadata?.devfit_account!==sha256Hex(order.email)||s.mode!=='payment'
    ||s.livemode!==order.livemode||s.currency!=='myr'||s.amount_total!==order.amount_cents
    ||s.amount_subtotal!==order.amount_cents) return {status:'mismatch'};
  if(s.payment_status!=='paid'||s.status!=='complete')return {status:'pending'};
  const pi=s.payment_intent,charge=pi?.latest_charge;
  if(!pi||typeof pi!=='object'||pi.status!=='succeeded'||pi.amount_received!==order.amount_cents
    ||pi.currency!=='myr'||pi.livemode!==order.livemode||pi.amount!==order.amount_cents
    ||!charge||typeof charge!=='object'||charge.paid!==true||charge.status!=='succeeded'
    ||charge.amount!==order.amount_cents||charge.currency!=='myr'||charge.livemode!==order.livemode
    ||charge.payment_intent!==pi.id||charge.refunded||charge.disputed||charge.amount_refunded!==0) return {status:'mismatch'};
  const result=await sbRpc('fulfill_devfit_checkout',{p_order_id:order.id,p_session_id:s.id,p_payment_intent:pi.id,
    p_amount:s.amount_total,p_currency:s.currency,p_livemode:s.livemode,
    p_paid_at:new Date((charge?.created||pi.created)*1000).toISOString()});
  return result||{status:'unavailable'};
}
export async function handleStripeOperation(req,res,email,body) {
  const cfg=stripeConfig(),catalog=await paymentOffers();
  if(!catalog){res.status(503).json({error:'billing_unavailable'});return;}
  let student=false;
  if(['billingHistory','createCheckout'].includes(body.op)){
    const eligibility=await sbSelect('devfit_checkout_eligibility','email=eq.'+encodeURIComponent(email)+'&select=student_approved&limit=1');
    if(!eligibility){res.status(503).json({error:'billing_unavailable'});return;}
    student=eligibility[0]?.student_approved===true;
  }
  if(body.op==='billingHistory'){
    const rows=await sbSelect('devfit_checkout_orders','email=eq.'+encodeURIComponent(email)+'&order=created_at.desc&limit=50');
    if(!rows){res.status(503).json({error:'billing_unavailable'});return;}
    res.status(200).json({email,enabled:cfg.ready,test:!cfg.live,
      offers:catalog.offers.filter(o=>o.code!=='coaching_student_4w'||student).map(o=>({...o,label:o.code==='app_pro'?'DevFit Pro · 1 calendar month':o.label})),
      orders:rows.map(publicOrder)});return;
  }
  if(!cfg.ready&&body.op!=='paymentInvoice'){res.status(503).json({error:'checkout_not_configured'});return;}
  const limited=await rateLimit('checkout:'+sha256Hex(email),body.op==='createCheckout'?5:30,60,{failClosed:true});
  if(!limited.ok){res.status(limited.unavailable?503:429).json({error:'checkout_busy'});return;}
  if(body.op==='createCheckout'){
    const review=await sbSelect('devfit_checkout_orders','email=eq.'+encodeURIComponent(email)+'&status=in.(refunded,disputed)&reviewed_at=is.null&limit=1');
    if(!review){res.status(503).json({error:'billing_unavailable'});return;}
    if(review.length){res.status(409).json({error:'payment_review_required'});return;}
    const offer=catalog.offers.find(o=>o.code===body.offerCode&&(o.code!=='coaching_student_4w'||student));
    if(!offer||!validOrderId(body.requestId)){res.status(400).json({error:'invalid_checkout'});return;}
    const name=String(body.name||'').trim().replace(/[\x00-\x1f]/g,' ').slice(0,80);
    const phone=String(body.phone||'').trim();
    if(name.length<2||!/^\+?[0-9\s()-]{7,24}$/.test(phone)||phone.replace(/\D/g,'').length<7||phone.replace(/\D/g,'').length>15){res.status(400).json({error:'invalid_contact'});return;}
    const inserted=await sbInsertIgnore('devfit_checkout_orders',{id:crypto.randomUUID(),email,request_id:body.requestId,
      offer_code:offer.code,offer_label:offer.code==='app_pro'?'DevFit Pro · 1 calendar month':offer.label,
      amount_cents:offer.amountCents,livemode:cfg.live,payer_name:name,payer_phone:phone},'email,request_id');
    if(!inserted){res.status(503).json({error:'billing_unavailable'});return;}
    const rows=await sbSelect('devfit_checkout_orders','email=eq.'+encodeURIComponent(email)+'&request_id=eq.'+body.requestId+'&limit=1');
    const order=rows?.[0];
    if(!order){res.status(503).json({error:'billing_unavailable'});return;}
    if(order.offer_code!==offer.code||order.livemode!==cfg.live||order.status!=='pending'){
      res.status(409).json({error:'checkout_already_used'});return;}
    // Reuse the database price snapshot and the same Stripe idempotency key
    // after a lost response/double tap. Never create two sessions for one order.
    if(Date.now()-Date.parse(order.created_at)>23*3600000){res.status(409).json({error:'checkout_expired'});return;}
    // Server-owned setting only: sandbox return URLs must not point at customers.
    const origin=process.env.DEVFIT_CHECKOUT_ORIGIN||'https://devfitportal.vercel.app';
    const returnUrl=new URL(origin);
    if(returnUrl.protocol!=='https:'||returnUrl.origin!==origin)throw Error('invalid_checkout_origin');
    const s=await stripeClient().checkout.sessions.create({mode:'payment',customer_email:email,adaptive_pricing:{enabled:false},allow_promotion_codes:false,
      client_reference_id:order.id,metadata:{devfit_order:order.id,devfit_account:sha256Hex(email)},
      line_items:[{price_data:{currency:'myr',unit_amount:order.amount_cents,product_data:{name:order.offer_label}},quantity:1}],
      payment_intent_data:{receipt_email:email,metadata:{devfit_order:order.id}},
      success_url:origin+'/settings.html?payment_order='+order.id,
      cancel_url:origin+'/settings.html?payment_cancelled=1',expires_at:Math.floor(Date.parse(order.created_at)/1000)+86400
    },{idempotencyKey:'devfit-order-'+order.id});
    const url=new URL(s.url||'');
    if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||s.livemode!==cfg.live)throw new Error('invalid_checkout_response');
    const saved=await sbPatch('devfit_checkout_orders','id=eq.'+order.id+'&email=eq.'+encodeURIComponent(email),{stripe_session_id:s.id,checkout_url:s.url});
    if(!saved){res.status(503).json({error:'billing_unavailable'});return;}
    res.status(200).json({orderId:order.id,url:s.url});return;
  }
  const order=await orderForAccount(email,body.orderId);
  if(!order){res.status(order===undefined?503:404).json({error:'order_unavailable'});return;}
  if(body.op==='checkoutStatus'){
    const result=await reconcileCheckout(order);
    if(!['ok','pending'].includes(result.status)){
      res.status(503).json({error:'payment_confirmation_pending'});return;
    }
    const current=await orderForAccount(email,order.id);
    if(!current){res.status(503).json({error:'billing_unavailable'});return;}
    res.status(200).json({order:publicOrder(current)});return;
  }
  if(body.op==='paymentInvoice'){
    if(order.status!=='paid'){res.status(409).json({error:'verified_payment_required'});return;}
    const {paymentInvoice}=await import('./_payment-invoice.js');
    res.status(200).json(paymentInvoice(order));return;
  }
  res.status(400).json({error:'unsupported_billing_operation'});
}
