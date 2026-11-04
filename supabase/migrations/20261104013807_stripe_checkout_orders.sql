-- Private, additive billing ledger. Existing manual payments/history remain.
set lock_timeout='3s';
set statement_timeout='20s';
create table public.devfit_checkout_orders (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.devfit_subscribers(email) on delete cascade,
  request_id uuid not null,
  offer_code text not null check(offer_code in ('app_pro','coaching_4w','coaching_8w','coaching_12w','coaching_student_4w')),
  offer_label text not null,
  amount_cents integer not null check(amount_cents>0 and amount_cents<=1000000),
  currency text not null default 'myr' check(currency='myr'),
  livemode boolean not null,
  status text not null default 'pending' check(status in ('pending','paid','refunded','disputed')),
  stripe_session_id text unique,
  stripe_payment_intent text unique,
  checkout_url text,
  payer_name text not null default '',
  payer_phone text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  access_start date,
  access_end date,
  anchor_day integer check(anchor_day between 1 and 31),
  reviewed_at timestamptz,
  review_refund_cents integer not null default 0,
  unique(email,request_id)
);
create index devfit_checkout_orders_email_created_idx on public.devfit_checkout_orders(email,created_at desc);
alter table public.devfit_checkout_orders enable row level security;
revoke all on public.devfit_checkout_orders from public,anon,authenticated;
grant select,insert,update on public.devfit_checkout_orders to service_role;
create policy checkout_orders_deny_browser on public.devfit_checkout_orders for all to anon,authenticated using(false) with check(false);
create table public.devfit_checkout_eligibility (
  email text primary key references public.devfit_subscribers(email) on delete cascade,
  student_approved boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.devfit_checkout_eligibility enable row level security;
revoke all on public.devfit_checkout_eligibility from public,anon,authenticated;
grant select,insert,update on public.devfit_checkout_eligibility to service_role;
create policy checkout_eligibility_deny_browser on public.devfit_checkout_eligibility for all to anon,authenticated using(false) with check(false);

-- Called only after server retrieval and verification of a PAID Stripe session.
-- Atomically locks the account and order so duplicate/concurrent webhooks never
-- extend access twice. Stripe test orders can NEVER alter customer entitlement.
create or replace function public.fulfill_devfit_checkout(p_order_id uuid,p_session_id text,
  p_payment_intent text,p_amount integer,p_currency text,p_livemode boolean,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.devfit_checkout_orders%rowtype;v_sub public.devfit_subscribers%rowtype;
  v_today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;v_base date;v_end date;v_anchor integer;v_month date;
begin
  -- Lock order is account -> order for every fulfillment of the same account.
  select * into v_order from public.devfit_checkout_orders where id=p_order_id;
  if not found then return jsonb_build_object('status','not_found');end if;
  select * into v_sub from public.devfit_subscribers where email=v_order.email for update;
  if not found or v_sub.approved is not true then return jsonb_build_object('status','account_unavailable');end if;
  select * into v_order from public.devfit_checkout_orders where id=p_order_id for update;
  if p_session_id is null or v_order.stripe_session_id is distinct from p_session_id
    or p_payment_intent is null or p_payment_intent !~ '^pi_[A-Za-z0-9_]+'
    or p_amount is distinct from v_order.amount_cents or p_currency is distinct from v_order.currency
    or p_livemode is distinct from v_order.livemode or p_paid_at is null
    or p_paid_at>now()+interval '5 minutes' then return jsonb_build_object('status','mismatch');end if;
  if v_order.status='paid' then
    if v_order.stripe_payment_intent is distinct from p_payment_intent then return jsonb_build_object('status','mismatch');end if;
    return jsonb_build_object('status','ok','duplicate',true,'expiry',v_order.access_end);
  end if;
  if v_order.status<>'pending' then return jsonb_build_object('status','closed');end if;
  if exists(select 1 from public.devfit_checkout_orders where email=v_order.email and status in ('refunded','disputed') and reviewed_at is null) then
    return jsonb_build_object('status','account_review');end if;
  if exists(select 1 from public.devfit_checkout_orders where stripe_payment_intent=p_payment_intent and id<>p_order_id) then
    return jsonb_build_object('status','mismatch');end if;
  if p_livemode then
    v_base:=greatest(v_today,case when v_sub.tier='pro' then v_sub.expiry else null end);
    if v_order.offer_code='app_pro' then
      select anchor_day into v_anchor from public.devfit_checkout_orders where email=v_order.email
        and status='paid' and livemode and access_end=v_base and offer_code='app_pro' order by paid_at desc limit 1;
      v_anchor:=coalesce(v_anchor,extract(day from v_base)::integer);
      v_month:=(date_trunc('month',v_base)+interval '1 month')::date;
      v_end:=v_month+least(v_anchor,extract(day from (v_month+interval '1 month' - interval '1 day'))::integer)-1;
    else
      v_end:=v_base+case v_order.offer_code when 'coaching_4w' then 28 when 'coaching_student_4w' then 28 when 'coaching_8w' then 56 else 84 end;
    end if;
    update public.devfit_subscribers set tier='pro',
      start_date=case when tier='pro' and expiry>=v_today then least(coalesce(start_date,v_today),v_today) else v_today end,
      expiry=v_end,plan=v_order.offer_label,updated_at=now() where email=v_order.email;
  end if;
  update public.devfit_checkout_orders set status='paid',stripe_payment_intent=p_payment_intent,paid_at=p_paid_at,
    access_start=case when p_livemode then v_base end,access_end=v_end,anchor_day=v_anchor where id=p_order_id;
  return jsonb_build_object('status','ok','duplicate',false,'expiry',v_end,'test',not p_livemode);
end;$$;
revoke all on function public.fulfill_devfit_checkout(uuid,text,text,integer,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.fulfill_devfit_checkout(uuid,text,text,integer,text,boolean,timestamptz) to service_role;

-- Refunds and disputes are exceptions requiring owner review of all remaining
-- paid/manual periods. Never auto-ban a customer or erase fitness history.
create function public.review_devfit_checkout_payment(p_payment_intent text,p_status text,p_refund_cents integer default 0,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.devfit_checkout_orders%rowtype;
begin
  if p_status not in ('refunded','disputed') then return jsonb_build_object('status','invalid');end if;
  select * into v_order from public.devfit_checkout_orders where
    (p_order_id is null and stripe_payment_intent=p_payment_intent)
    or (id=p_order_id and (stripe_payment_intent=p_payment_intent or stripe_payment_intent is null));
  if not found then return jsonb_build_object('status','not_found');end if;
  perform 1 from public.devfit_subscribers where email=v_order.email for update;
  select * into v_order from public.devfit_checkout_orders where id=v_order.id for update;
  if v_order.stripe_payment_intent is not null and v_order.stripe_payment_intent<>p_payment_intent then
    return jsonb_build_object('status','mismatch');end if;
  if p_refund_cents<0 or p_refund_cents>v_order.amount_cents then return jsonb_build_object('status','invalid');end if;
  if v_order.status=p_status and v_order.review_refund_cents>=p_refund_cents then return jsonb_build_object('status','ok','duplicate',true);end if;
  update public.devfit_checkout_orders set status=p_status,stripe_payment_intent=p_payment_intent,reviewed_at=null,review_refund_cents=p_refund_cents where id=v_order.id;
  -- Refund-before-activation closes the new order but leaves existing paid or
  -- manual access untouched. Same account/order locks serialize with fulfillment.
  if v_order.livemode and v_order.status<>'pending' then
    update public.devfit_subscribers set tier='free',updated_at=now() where email=v_order.email;
    insert into public.devfit_security_events(email,event_type,severity,route,reason,blocked)
      values(v_order.email,'payment_review','warning','/api/stripe-webhook','Stripe refund/dispute: review remaining entitlement before restoring Pro',false);
  end if;
  return jsonb_build_object('status','ok');
end;$$;
revoke all on function public.review_devfit_checkout_payment(text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.review_devfit_checkout_payment(text,text,integer,uuid) to service_role;
