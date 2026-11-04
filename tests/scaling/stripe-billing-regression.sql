begin;
do $$
declare e text:='stripe-qa@example.invalid';o uuid:=gen_random_uuid();o2 uuid:=gen_random_uuid();t uuid:=gen_random_uuid();early uuid:=gen_random_uuid();v jsonb;
begin
  assert current_database() like 'devfit_scale%';
  assert exists(select 1 from public.devfit_scale_environment);
  insert into public.devfit_subscribers(email,approved,tier,expiry)values(e,true,'pro','2099-01-31');
  insert into public.devfit_checkout_orders(id,email,request_id,offer_code,offer_label,amount_cents,livemode,stripe_session_id)
    values(o,e,gen_random_uuid(),'app_pro','Pro',1990,true,'cs_live_qa');
  v:=public.fulfill_devfit_checkout(o,'cs_live_qa','pi_qa',1,'myr',true,now());assert v->>'status'='mismatch';
  assert (select expiry='2099-01-31' from public.devfit_subscribers where email=e);
  v:=public.fulfill_devfit_checkout(o,'wrong','pi_qa',1990,'myr',true,now());assert v->>'status'='mismatch';
  v:=public.fulfill_devfit_checkout(o,'cs_live_qa','pi_qa',1990,'usd',true,now());assert v->>'status'='mismatch';
  v:=public.fulfill_devfit_checkout(o,'cs_live_qa','pi_qa',1990,'myr',false,now());assert v->>'status'='mismatch';
  v:=public.fulfill_devfit_checkout(o,'cs_live_qa','pi_qa',1990,'myr',true,now());assert v->>'status'='ok';
  assert (select expiry='2099-02-28' from public.devfit_subscribers where email=e),'Calendar month clamps Jan 31';
  v:=public.fulfill_devfit_checkout(o,'cs_live_qa','pi_qa',1990,'myr',true,now());assert (v->>'duplicate')::boolean;
  assert (select expiry='2099-02-28' from public.devfit_subscribers where email=e),'Duplicate cannot add access';
  insert into public.devfit_checkout_orders(id,email,request_id,offer_code,offer_label,amount_cents,livemode,stripe_session_id)
    values(o2,e,gen_random_uuid(),'app_pro','Pro',1990,true,'cs_live_qa2');
  v:=public.fulfill_devfit_checkout(o2,'cs_live_qa2','pi_qa',1990,'myr',true,now());assert v->>'status'='mismatch','Intent cannot pay two orders';
  v:=public.fulfill_devfit_checkout(o2,'cs_live_qa2','pi_qa2',1990,'myr',true,now());assert v->>'status'='ok';
  assert (select expiry='2099-03-31' from public.devfit_subscribers where email=e),'Original anchor day survives February';
  insert into public.devfit_checkout_orders(id,email,request_id,offer_code,offer_label,amount_cents,livemode,stripe_session_id)
    values(t,e,gen_random_uuid(),'app_pro','Pro',1990,false,'cs_test_qa');
  v:=public.fulfill_devfit_checkout(t,'cs_test_qa','pi_test_qa',1990,'myr',false,now());assert v->>'status'='ok';
  assert (select expiry='2099-03-31' from public.devfit_subscribers where email=e),'Test payment never alters Pro';
  assert (select access_end is null from public.devfit_checkout_orders where id=t);
  insert into public.devfit_checkout_orders(id,email,request_id,offer_code,offer_label,amount_cents,livemode,stripe_session_id)
    values(early,e,gen_random_uuid(),'app_pro','Pro',1990,true,'cs_early_refund');
  v:=public.review_devfit_checkout_payment('pi_early_refund','refunded',1990,early);assert v->>'status'='ok';
  assert (select tier='pro' and expiry='2099-03-31' from public.devfit_subscribers where email=e),'Refund before fulfillment must preserve existing access';
  v:=public.fulfill_devfit_checkout(early,'cs_early_refund','pi_early_refund',1990,'myr',true,now());assert v->>'status'='closed','A late paid delivery cannot resurrect a refunded order';
  v:=public.review_devfit_checkout_payment('pi_qa2','refunded');assert v->>'status'='ok';
  assert (select tier='free' and approved is true from public.devfit_subscribers where email=e),'Refund review retains login and data but suspends disputed entitlement';
  assert (select reviewed_at is null from public.devfit_checkout_orders where id=o2);
  v:=public.review_devfit_checkout_payment('pi_qa2','refunded');assert (v->>'duplicate')::boolean;
  assert not has_table_privilege('anon','public.devfit_checkout_eligibility','SELECT');
  assert not has_table_privilege('anon','public.devfit_checkout_orders','SELECT');
  assert not has_table_privilege('authenticated','public.devfit_checkout_orders','INSERT');
  assert not has_function_privilege('anon','public.fulfill_devfit_checkout(uuid,text,text,integer,text,boolean,timestamptz)','EXECUTE');
  raise notice 'Stripe ledger correctness checks passed; fixtures roll back';
end;$$;
rollback;
