-- Managed pg_net objects have platform-owned ACLs; do not rely on revoking those
-- as the non-superuser project role. Keep net outside the exposed Data API, and
-- never put a permanent credential in its transient HTTP request/response tables.
set lock_timeout='3s';
set statement_timeout='20s';
alter table public.devfit_job_auth add column token_expires_at timestamptz;

create or replace function public.claim_devfit_notifications(p_job_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_jobs jsonb;v_authorized text;
begin
  if p_job_token is null or p_job_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','unauthorized');end if;
  -- Compare-and-consume in one row update: even simultaneous duplicate HTTP
  -- requests cannot reuse a capability, including an empty rollout probe.
  update public.devfit_job_auth set token_expires_at=null,last_worker_at=clock_timestamp()
    where name='notifications' and enabled and token_expires_at>clock_timestamp()
      and token_hash=encode(extensions.digest(p_job_token,'sha256'),'hex')
    returning name into v_authorized;
  if not found then return jsonb_build_object('status','unauthorized');end if;
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
    from due where o.id=due.id returning o.id,o.payment_id,o.support_id,o.lease_id
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into v_jobs from claimed;
  return jsonb_build_object('status','ok','jobs',v_jobs);
end;$$;
revoke all on function public.claim_devfit_notifications(text) from public,anon,authenticated;
grant execute on function public.claim_devfit_notifications(text) to service_role;

create or replace function public.dispatch_devfit_notifications() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token text;
begin
  if not exists(select 1 from public.devfit_job_auth where name='notifications' and enabled) then return;end if;
  delete from cron.job_run_details where runid in (
    select d.runid from cron.job_run_details d join cron.job j on j.jobid=d.jobid
    where j.jobname='devfit-notification-retries' and d.end_time<now()-interval '7 days'
    order by d.end_time limit 100);
  delete from public.devfit_notification_outbox where id in (
    select id from public.devfit_notification_outbox where state='sent' and finished_at<now()-interval '30 days'
    order by finished_at for update skip locked limit 100);
  delete from public.devfit_sessions where session_hash in (
    select session_hash from public.devfit_sessions where expires_at<now()
    order by expires_at for update skip locked limit 100);
  if not exists(select 1 from public.devfit_notification_outbox where state in ('pending','leased')
    and next_attempt_at<=now() and (lease_until is null or lease_until<=now()))
    and exists(select 1 from public.devfit_job_auth where name='notifications' and last_worker_at is not null) then return;end if;
  if not exists(select 1 from public.devfit_job_auth where name='notifications'
    and (last_dispatch_at is null or last_dispatch_at<now()-interval '4 minutes') for update skip locked) then return;end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  -- The only plaintext token is a single-use, two-minute nonce in transit. No
  -- service key, owner password, customer token or reusable Vault key is sent.
  update public.devfit_job_auth set token_hash=encode(extensions.digest(v_token,'sha256'),'hex'),
    token_expires_at=now()+interval '2 minutes',last_dispatch_at=now() where name='notifications';
  perform net.http_post(url:='https://devfitportal.vercel.app/api/admin',
    headers:=jsonb_build_object('Content-Type','application/json','x-devfit-job',v_token),
    body:='{}'::jsonb,timeout_milliseconds:=60000);
end;$$;
revoke all on function public.dispatch_devfit_notifications() from public,anon,authenticated,service_role;

-- Invalidate any capability issued before this hardening, then verify the live
-- route with an empty queue. Disposable CI must never call the production URL.
do $$ begin
  if to_regclass('public.devfit_scale_environment') is not null then return;end if;
  update public.devfit_job_auth set token_expires_at=null,last_dispatch_at=null,last_worker_at=null where name='notifications';
  perform public.dispatch_devfit_notifications();
end;$$;
