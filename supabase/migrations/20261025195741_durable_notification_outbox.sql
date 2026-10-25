-- A receipt/support insert and its retry job commit together. Do not backfill
-- historic requests: that could unexpectedly re-email already handled tickets.
set lock_timeout='3s';
set statement_timeout='20s';
create table public.devfit_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid unique references public.devfit_payments(id) on delete cascade,
  support_id uuid unique references public.devfit_support_requests(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','leased','sent','exhausted')),
  attempts integer not null default 0 check(attempts between 0 and 6),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now()+interval '2 minutes',
  lease_id uuid,
  lease_until timestamptz,
  finished_at timestamptz,
  last_error text,
  check(num_nonnulls(payment_id,support_id)=1)
);
create index devfit_notification_due_idx on public.devfit_notification_outbox(next_attempt_at)
  where state in ('pending','leased');
alter table public.devfit_notification_outbox enable row level security;
revoke all on public.devfit_notification_outbox from public,anon,authenticated,service_role;
grant select on public.devfit_notification_outbox to service_role;
create policy devfit_notification_deny_browser on public.devfit_notification_outbox
  for all to anon,authenticated using(false) with check(false);

create table public.devfit_job_auth (
  name text primary key check(name='notifications'),
  token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false,
  last_dispatch_at timestamptz,
  last_worker_at timestamptz
);
alter table public.devfit_job_auth enable row level security;
revoke all on public.devfit_job_auth from public,anon,authenticated,service_role;
create policy devfit_job_auth_deny_browser on public.devfit_job_auth
  for all to anon,authenticated using(false) with check(false);

create function public.track_devfit_notification() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    if tg_table_name='devfit_payments' then
      insert into public.devfit_notification_outbox(payment_id) values(new.id) on conflict do nothing;
    else
      insert into public.devfit_notification_outbox(support_id) values(new.id) on conflict do nothing;
    end if;
  end if;
  if new.email_status='sent' then
    update public.devfit_notification_outbox set state='sent',finished_at=now(),lease_id=null,lease_until=null,last_error=null
      where (tg_table_name='devfit_payments' and payment_id=new.id)
         or (tg_table_name='devfit_support_requests' and support_id=new.id);
  end if;
  return new;
end;$$;
revoke all on function public.track_devfit_notification() from public,anon,authenticated,service_role;
create trigger devfit_payment_outbox after insert or update of email_status on public.devfit_payments
  for each row execute function public.track_devfit_notification();
create trigger devfit_support_outbox after insert or update of email_status on public.devfit_support_requests
  for each row execute function public.track_devfit_notification();

-- The public callback can only claim a bounded batch with the independent,
-- high-entropy scheduler credential. It cannot select arbitrary recipients.
create function public.claim_devfit_notifications(p_job_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_jobs jsonb;
begin
  if p_job_token is null or p_job_token !~ '^[0-9a-f]{64}$' or not exists(
    select 1 from public.devfit_job_auth where name='notifications' and enabled
      and token_hash=encode(extensions.digest(p_job_token,'sha256'),'hex')) then
    return jsonb_build_object('status','unauthorized');
  end if;
  update public.devfit_job_auth set last_worker_at=now() where name='notifications';
  -- Resend deduplicates for 24 hours. Stop automatic delivery after 23 hours,
  -- including jobs whose worker crashed on its final attempt. Owner review is
  -- preferable to a blind duplicate outside the provider's deduplication window.
  update public.devfit_notification_outbox set state='exhausted',finished_at=now(),
    last_error='automatic_retry_window_ended',lease_id=null,lease_until=null
    where id in (select id from public.devfit_notification_outbox
      where state in ('pending','leased') and (lease_until is null or lease_until<=now())
        and (created_at<=now()-interval '23 hours' or attempts>=6)
      order by next_attempt_at for update skip locked limit 100);
  with due as (
    select id from public.devfit_notification_outbox
    where state in ('pending','leased') and next_attempt_at<=now()
      and (lease_until is null or lease_until<=now())
    order by next_attempt_at,id for update skip locked limit 2
  ), claimed as (
    update public.devfit_notification_outbox o set state='leased',attempts=attempts+1,
      lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes'
    from due where o.id=due.id
    returning o.id,o.payment_id,o.support_id,o.lease_id
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into v_jobs from claimed;
  return jsonb_build_object('status','ok','jobs',v_jobs);
end;$$;
revoke all on function public.claim_devfit_notifications(text) from public,anon,authenticated;
grant execute on function public.claim_devfit_notifications(text) to service_role;

create function public.finish_devfit_notification(p_id uuid,p_lease_id uuid,p_ok boolean,
  p_message_id text default null,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.devfit_notification_outbox%rowtype;v_status text;v_delay interval;
begin
  select * into v_job from public.devfit_notification_outbox where id=p_id;
  if not found then return jsonb_build_object('status','missing');end if;
  -- Match the source->outbox lock order used by insert/status triggers. Locking
  -- outbox first here would deadlock with the normal inline delivery response.
  if v_job.payment_id is not null then
    select email_status into v_status from public.devfit_payments where id=v_job.payment_id for update;
  else
    select email_status into v_status from public.devfit_support_requests where id=v_job.support_id for update;
  end if;
  select * into v_job from public.devfit_notification_outbox where id=p_id for update;
  if not found then return jsonb_build_object('status','missing');end if;
  if v_status='sent' or v_job.state='sent' then return jsonb_build_object('status','sent');end if;
  if v_job.state<>'leased' or v_job.lease_id is distinct from p_lease_id or v_job.lease_until<=now() then
    return jsonb_build_object('status','stale_lease');end if;
  if p_ok is true then
    if v_job.payment_id is not null then
      update public.devfit_payments set email_status='sent',email_error=null,notified_at=now() where id=v_job.payment_id;
    else
      update public.devfit_support_requests set email_status='sent',email_error=null,
        email_message_id=left(p_message_id,200),notified_at=now(),updated_at=now() where id=v_job.support_id;
    end if;
    return jsonb_build_object('status','sent');
  end if;
  if v_job.payment_id is not null then
    update public.devfit_payments set email_status='failed',email_error=left(p_error,100) where id=v_job.payment_id;
  else
    update public.devfit_support_requests set email_status='failed',email_error=left(p_error,100),updated_at=now() where id=v_job.support_id;
  end if;
  v_delay:=case v_job.attempts when 1 then interval '5 minutes' when 2 then interval '15 minutes'
    when 3 then interval '1 hour' when 4 then interval '3 hours' else interval '6 hours' end;
  update public.devfit_notification_outbox set
    state=case when attempts>=6 then 'exhausted' else 'pending' end,
    next_attempt_at=now()+v_delay,lease_id=null,lease_until=null,
    finished_at=case when attempts>=6 then now() else null end,last_error=left(p_error,100)
    where id=p_id;
  return jsonb_build_object('status',case when v_job.attempts>=6 then 'exhausted' else 'pending' end);
end;$$;
revoke all on function public.finish_devfit_notification(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.finish_devfit_notification(uuid,uuid,boolean,text,text) to service_role;

create function public.devfit_notification_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'pending',(select count(*) from public.devfit_notification_outbox where state in ('pending','leased')),
    'needsReview',(select count(*) from public.devfit_notification_outbox where state='exhausted'),
    'oldestPendingAt',(select min(created_at) from public.devfit_notification_outbox where state in ('pending','leased')),
    'enabled',coalesce((select enabled from public.devfit_job_auth where name='notifications'),false),
    'lastWorkerAt',(select last_worker_at from public.devfit_job_auth where name='notifications')
  );
$$;
revoke all on function public.devfit_notification_status() from public,anon,authenticated;
grant execute on function public.devfit_notification_status() to service_role;
