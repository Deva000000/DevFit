import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
process.env.SUPABASE_SERVICE_KEY='synthetic-billing-only';
process.env.DEVFIT_JWT_SECRET='synthetic-billing-only';
process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.STRIPE_MODE='test';process.env.STRIPE_WEBHOOK_SECRET='whsec_synthetic';
const {reconcileCheckout,stripeConfig,publicOrder}=await import('../api/_stripe-payments.js');
const {sha256Hex}=await import('../api/_lib.js');
const {default:webhook,rawStripeBody}=await import('../api/_stripe-webhook.js');
const order={id:'f2a26498-1509-4cb5-80e2-49d59a18bc76',email:'qa@example.invalid',amount_cents:1990,currency:'myr',livemode:false,stripe_session_id:'cs_test_qa'};
const paid=()=>({id:order.stripe_session_id,client_reference_id:order.id,metadata:{devfit_order:order.id,devfit_account:sha256Hex(order.email)},
  mode:'payment',livemode:false,currency:'myr',amount_total:1990,amount_subtotal:1990,payment_status:'paid',status:'complete',
  payment_intent:{id:'pi_qa',status:'succeeded',amount:1990,amount_received:1990,currency:'myr',livemode:false,created:Math.floor(Date.now()/1000),latest_charge:{created:Math.floor(Date.now()/1000),paid:true,status:'succeeded',amount:1990,currency:'myr',livemode:false,payment_intent:'pi_qa',refunded:false,disputed:false,amount_refunded:0}}});
test('every identity/amount/currency/mode mismatch is rejected before entitlement RPC',async()=>{
  const original=fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('should not call');};
  try{
    const changes=[s=>s.amount_total=1,s=>s.amount_subtotal=1,s=>s.currency='usd',s=>s.livemode=true,s=>s.client_reference_id='another-order',s=>s.metadata.devfit_account=sha256Hex('other@example.invalid'),s=>s.payment_intent.amount_received=1,s=>s.payment_intent.latest_charge.refunded=true,s=>s.payment_intent.latest_charge.disputed=true,s=>s.payment_intent.latest_charge.amount_refunded=100];
    for(const change of changes){const s=paid();change(s);assert.equal((await reconcileCheckout(order,{checkout:{sessions:{retrieve:async()=>s}}})).status,'mismatch');}
    for(const change of [s=>s.payment_intent.latest_charge=null,s=>s.payment_intent.latest_charge='ch_unexpanded',s=>s.payment_intent.latest_charge.payment_intent='pi_other',s=>s.payment_intent.latest_charge.paid=false,s=>s.payment_intent.latest_charge.amount=1,s=>s.payment_intent.latest_charge.livemode=true]){
      const s=paid();change(s);assert.equal((await reconcileCheckout(order,{checkout:{sessions:{retrieve:async()=>s}}})).status,'mismatch');
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test('unpaid, processing or abandoned checkout never activates Pro',async()=>{
  for(const state of ['unpaid','no_payment_required']){const s=paid();s.payment_status=state;
    assert.equal((await reconcileCheckout(order,{checkout:{sessions:{retrieve:async()=>s}}})).status,'pending');}
});
test('valid payment uses only verified provider fields and private order id',async()=>{
  const original=fetch;let body;
  globalThis.fetch=async(u,o)=>{assert.match(u,/fulfill_devfit_checkout$/);body=JSON.parse(o.body);return new Response(JSON.stringify({status:'ok',test:true}));};
  try{assert.equal((await reconcileCheckout(order,{checkout:{sessions:{retrieve:async()=>paid()}}})).status,'ok');
    assert.equal(body.p_order_id,order.id);assert.equal(body.p_amount,1990);assert.equal(body.p_livemode,false);
  }finally{globalThis.fetch=original;}
});
test('webhook refuses reserialized JSON, invalid signatures, stale signatures and wrong mode',async()=>{
  const stripe=new Stripe('sk_test_synthetic');
  await assert.rejects(rawStripeBody({body:{data:'parsed'}}),/raw_body_required/);
  for(const mode of ['bad','old','wrong_mode']){
    const body=JSON.stringify({id:'evt_qa',type:'invoice.created',livemode:mode==='wrong_mode',data:{object:{}}});
    const signature=mode==='bad'?'t=1,v1=bad':stripe.webhooks.generateTestHeaderString({payload:body,secret:'whsec_synthetic',timestamp:mode==='old'?1:Math.floor(Date.now()/1000)});
    const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
    await webhook({method:'POST',headers:{'stripe-signature':signature},body},res);assert.equal(res.code,400);
  }
});
test('billing defaults disabled, live/test keys cannot be mixed, and public history is bounded metadata',()=>{
  assert.equal(stripeConfig().ready,false);
  process.env.DEVFIT_STRIPE_ENABLED='true';process.env.STRIPE_MODE='live';assert.equal(stripeConfig().ready,false);
  process.env.STRIPE_MODE='test';assert.equal(stripeConfig().ready,true);delete process.env.DEVFIT_STRIPE_ENABLED;
  const p=publicOrder({...order,stripe_payment_intent:'private_ref',checkout_url:'private_url',request_id:'private_request'});
  assert(!JSON.stringify(p).includes('private_'));assert.equal(p.id,order.id);
});

test('actual billing API binds checkout to signed account and server price; retries reuse one order',async()=>{
  const {domainHandler,sessionClaims}=await import('./session-fixture.mjs');
  const {default:dataHandler}=await import('../api/data.js');const {signToken}=await import('../api/_lib.js');
  const handler=domainHandler(dataHandler),original=fetch,orders=[];let stripeFields,requestKey;
  process.env.DEVFIT_STRIPE_ENABLED='true';
  globalThis.fetch=async(u,o={})=>{
    const url=new URL(String(u)),name=url.pathname.split('/').at(-1);
    const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    if(url.hostname==='api.stripe.com'){
      assert.equal(url.pathname,'/v1/checkout/sessions');stripeFields=new URLSearchParams(o.body);
      const key=new Headers(o.headers).get('Idempotency-Key');if(requestKey)assert.equal(key,requestKey);requestKey=key;
      return response({id:'cs_test_provider',url:'https://checkout.stripe.com/c/pay/qa',livemode:false});
    }
    if(name==='consume_devfit_rate_limit')return response({allowed:true});
    if(name==='devfit_config')return response([{price:'19.90'}]);
    if(name==='devfit_checkout_eligibility')return response([{student_approved:false}]);
    assert.equal(name,'devfit_checkout_orders');
    if(o.method==='POST'){
      const row=JSON.parse(o.body);if(!orders.some(x=>x.email===row.email&&x.request_id===row.request_id))orders.push({...row,status:'pending',created_at:new Date().toISOString()});
      return response([]);
    }
    const matches=orders.filter(row=>[...url.searchParams].every(([k,v])=>!v.startsWith('eq.')||row[k]===v.slice(3)));
    if(url.searchParams.has('status'))return response([]);
    if(o.method==='PATCH'){matches.forEach(row=>Object.assign(row,JSON.parse(o.body)));return response(matches);}
    return response(matches);
  };
  const run=async body=>{const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
    await handler({method:'POST',headers:{authorization:'Bearer '+signToken(sessionClaims({email:order.email}))},body},res);return res;};
  try{
    const body={op:'createCheckout',requestId:'3ca0eb84-0f7f-4443-a383-fd227a99e315',offerCode:'app_pro',name:'QA buyer',phone:'+60123456789',email:'victim@example.invalid',amountCents:1};
    const first=await run(body),again=await run(body);assert.equal(first.code,200);assert.equal(again.code,200);assert.equal(orders.length,1);
    assert.equal(orders[0].email,order.email);assert.equal(orders[0].amount_cents,1990);
    assert.equal(stripeFields.get('line_items[0][price_data][unit_amount]'),'1990');
    assert.equal(stripeFields.get('customer_email'),order.email);assert.equal(stripeFields.get('mode'),'payment');
    assert.equal(stripeFields.get('client_reference_id'),orders[0].id);
    assert.equal((await run({...body,requestId:'6a3cd2bc-9ea4-4e95-b60d-1f39ed691742',offerCode:'coaching_student_4w'})).code,400);
    assert.equal((await run({op:'paymentInvoice',orderId:order.id})).code,404,'A different order/account cannot be downloaded');
    assert.equal((await run({op:'paymentInvoice',orderId:orders[0].id})).code,409,'Pending payment cannot produce a paid invoice');
  }finally{globalThis.fetch=original;delete process.env.DEVFIT_STRIPE_ENABLED;}
});

test('signed webhook re-reads provider payment; refund mode mismatch never reaches ledger',async()=>{
  const original=fetch,stripe=new Stripe('sk_test_synthetic');let fulfill=0,review=0;
  globalThis.fetch=async(u,o={})=>{
    const url=new URL(String(u)),name=url.pathname.split('/').at(-1);
    const response=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
    if(url.hostname==='api.stripe.com'){
      if(url.pathname.includes('/checkout/sessions/'))return response(paid());
      if(url.pathname.includes('/charges/'))return response({id:'ch_qa',payment_intent:'pi_qa',livemode:false,amount:1990,currency:'myr',amount_refunded:1990});
      if(url.pathname.includes('/payment_intents/'))return response({id:'pi_qa',livemode:false,amount:1990,currency:'myr',metadata:{devfit_order:order.id}});
      throw Error('Unexpected provider route');
    }
    if(name==='devfit_checkout_orders')return response([{...order,livemode:review===-1}]);
    if(name==='fulfill_devfit_checkout'){fulfill++;assert.equal(JSON.parse(o.body).p_amount,1990);return response({status:'ok'});}
    if(name==='review_devfit_checkout_payment'){review++;return response({status:'ok'});}
    throw Error('Unexpected database route');
  };
  const deliver=async(type,object)=>{
    const body=JSON.stringify({id:'evt_signed_qa',type,livemode:false,data:{object}});
    const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
    await webhook({method:'POST',body,headers:{'stripe-signature':stripe.webhooks.generateTestHeaderString({payload:body,secret:'whsec_synthetic'})}},res);
    return res.code;
  };
  try{
    assert.equal(await deliver('checkout.session.completed',{id:order.stripe_session_id,metadata:{devfit_order:order.id},amount_total:1}),200);
    assert.equal(fulfill,1,'Untrusted event amount is replaced by canonical provider amount');
    assert.equal(await deliver('charge.refunded',{id:'ch_qa'}),200);assert.equal(review,1);
    review=-1;
    assert.equal(await deliver('charge.refunded',{id:'ch_qa'}),400);assert.equal(review,-1,'Test event cannot suspend a live order');
  }finally{globalThis.fetch=original;}
});

test('only authenticated owner can reconcile Stripe; edited paid flags and amounts grant nothing',async()=>{
  process.env.DEVFIT_ADMIN_PASSWORD='synthetic-owner-password';
  const {default:admin}=await import('../api/admin.js');
  const {signAdminSession}=await import('../api/_lib.js');
  const original=fetch;let fulfilled=0,providerPaid=false,wrongAmount=false;
  const row={...order,status:'pending',offer_code:'app_pro',offer_label:'Pro',created_at:new Date().toISOString()};
  globalThis.fetch=async(u,o={})=>{
    const url=new URL(String(u)),name=url.pathname.split('/').at(-1);
    const response=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
    if(url.hostname==='api.stripe.com'){
      const s=paid();if(!providerPaid)s.payment_status='unpaid';if(wrongAmount)s.amount_total=1;
      return response(s);
    }
    if(name==='consume_devfit_rate_limit')return response({allowed:true});
    if(name==='devfit_checkout_orders')return response([row]);
    if(name==='fulfill_devfit_checkout'){fulfilled++;row.status='paid';return response({status:'ok'});}
    if(name==='devfit_security_events')return response([]);
    throw Error('Unexpected route '+name);
  };
  const run=async(auth=true,extra={})=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
    await admin({method:'POST',headers:{host:'devfit.test',origin:'https://devfit.test',...(auth?{cookie:'devfit_admin_session='+signAdminSession()}: {})},body:{action:'stripeReconcile',id:row.id,status:'paid',amountCents:1,...extra}},res);
    return res;
  };
  try{
    assert.equal((await run(false)).code,401);assert.equal(fulfilled,0);
    assert.equal((await run(true,{id:'invalid'})).code,400);
    const unpaid=await run();assert.equal(unpaid.code,200);assert.equal(unpaid.body.order.status,'pending');assert.equal(fulfilled,0);
    providerPaid=true;wrongAmount=true;assert.equal((await run()).code,409);assert.equal(fulfilled,0);
    wrongAmount=false;row.livemode=true;assert.equal((await run()).code,409);assert.equal(fulfilled,0);
    row.livemode=false;const verified=await run();assert.equal(verified.code,200);assert.equal(verified.body.order.status,'paid');assert.equal(fulfilled,1);
    const saved=process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_SECRET_KEY;
    try{assert.equal((await run()).code,503);}finally{process.env.STRIPE_SECRET_KEY=saved;}
  }finally{globalThis.fetch=original;delete process.env.DEVFIT_ADMIN_PASSWORD;}
});

test('public and rewritten webhook URLs avoid Vercel legacy query getter and require a valid signature',async()=>{
  const {default:admin}=await import('../api/admin.js');
  for(const url of ['/api/stripe-webhook','/api/admin?webhook=stripe']){
    const req={method:'POST',url,headers:{'stripe-signature':'invalid'},body:'{}'};
    Object.defineProperty(req,'query',{get(){throw Error('Legacy query getter must not run');}});
    const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};
    await admin(req,res);assert.equal(res.code,400);assert.equal(res.body.error,'invalid_signature');
  }
});
