// Dedicated raw-body endpoint; Stripe signatures, not browser cookies.
import { setApiSecurityHeaders,sbSelect,sbRpc,recordServerEvent } from './_lib.js';
import { stripeConfig,stripeClient,reconcileCheckout,validOrderId } from './_stripe-payments.js';
export async function rawStripeBody(req) {
  if(Buffer.isBuffer(req.body))return req.body;
  if(typeof req.body==='string')return Buffer.from(req.body);
  if(req.body&&typeof req.body==='object')throw new Error('raw_body_required');
  let size=0;const parts=[];
  for await(const part of req){const b=Buffer.from(part);size+=b.length;if(size>262144)throw new Error('body_too_large');parts.push(b);}
  return Buffer.concat(parts);
}
export default async function handler(req,res) {
  setApiSecurityHeaders(res);
  if(req.method!=='POST'){res.status(405).json({error:'method'});return;}
  const cfg=stripeConfig();
  if(!cfg.configured){res.status(503).json({error:'webhook_not_configured'});return;}
  const client=stripeClient();let event;
  try{event=client.webhooks.constructEvent(await rawStripeBody(req),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
  catch(_){res.status(400).json({error:'invalid_signature'});return;}
  if(event.livemode!==cfg.live){res.status(400).json({error:'mode_mismatch'});return;}
  if(['charge.refunded','charge.dispute.created'].includes(event.type)){
    try{
      const object=event.data.object;
      const charge=event.type==='charge.refunded'?await client.charges.retrieve(object.id):await client.charges.retrieve(typeof object.charge==='string'?object.charge:object.charge.id);
      if(charge.livemode!==cfg.live||!charge.payment_intent)throw Error('invalid_charge');
      if(event.type==='charge.refunded'&&!(charge.amount_refunded>0)){res.status(200).json({received:true});return;}
      if(event.type==='charge.dispute.created'&&!charge.disputed){res.status(200).json({received:true});return;}
      const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent.id;
      const pi=await client.paymentIntents.retrieve(intent);
      const orderId=pi.metadata?.devfit_order;
      if(!validOrderId(orderId)){res.status(200).json({received:true});return;}
      const orders=await sbSelect('devfit_checkout_orders','id=eq.'+orderId+'&limit=1');
      if(!orders)throw Error('order_store_unavailable');
      const order=orders[0];
      if(!order){res.status(200).json({received:true});return;}
      if(order.livemode!==cfg.live||pi.livemode!==order.livemode||pi.amount!==order.amount_cents||pi.currency!==order.currency
        ||charge.amount!==order.amount_cents||charge.currency!==order.currency){res.status(400).json({error:'order_mismatch'});return;}
      const result=await sbRpc('review_devfit_checkout_payment',{p_payment_intent:intent,p_status:event.type==='charge.refunded'?'refunded':'disputed',p_refund_cents:Number(charge.amount_refunded)||0,p_order_id:orderId});
      if(!result||!['ok','not_found'].includes(result.status))throw Error('review_store_unavailable');
      res.status(200).json({received:true});return;
    }catch(_){await recordServerEvent('stripe_payment','Refund or dispute needs reconciliation retry',{page:'/api/stripe-webhook',status:503});res.status(503).json({error:'retry_delivery'});return;}
  }
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
    res.status(200).json({received:true});return;
  }
  try{
    const session=event.data.object,id=session.metadata?.devfit_order;
    if(!validOrderId(id)){res.status(200).json({received:true});return;}
    const rows=await sbSelect('devfit_checkout_orders','id=eq.'+id+'&limit=1');
    if(!rows)throw new Error('order_store_unavailable');
    const order=rows[0];
    if(!order){res.status(200).json({received:true});return;}
    if(session.id!==order.stripe_session_id)throw new Error('session_binding_pending');
    const result=await reconcileCheckout(order,client);
    if(!['ok','pending'].includes(result.status))throw new Error('payment_not_reconciled');
    res.status(200).json({received:true});
  }catch(_){
    await recordServerEvent('stripe_payment','Verified payment reconciliation needs retry',{page:'/api/stripe-webhook',status:503});
    res.status(503).json({error:'retry_delivery'});
  }
}
