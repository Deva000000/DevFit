-- Hosted scheduler only. The disposable, loopback-only test database has an
-- explicit marker and does not install managed background-worker extensions.
-- New hosted staging MUST keep this job disabled and use separate provider keys.
set lock_timeout='3s';
set statement_timeout='20s';
create index if not exists devfit_sessions_expiry_idx on public.devfit_sessions(expires_at);
create index if not exists devfit_notification_finished_idx on public.devfit_notification_outbox(finished_at) where state='sent';
do $$ begin
  if to_regclass('public.devfit_scale_environment') is not null then return;end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  revoke all on schema net from public,anon,authenticated;
  revoke all on all tables in schema net from public,anon,authenticated;
  revoke all on all functions in schema net from public,anon,authenticated;
end;$$;

create or replace function public.dispatch_devfit_notifications() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_secret text;
begin
  if not exists(select 1 from public.devfit_job_auth where name='notifications' and enabled) then return;end if;
  -- Only this job's old scheduler diagnostics; never remove another job's logs.
  delete from cron.job_run_details where runid in (
    select d.runid from cron.job_run_details d join cron.job j on j.jobid=d.jobid
    where j.jobname='devfit-notification-retries' and d.end_time<now()-interval '7 days'
    order by d.end_time limit 100);
  -- Small bounded housekeeping only. Never prune customer diaries, receipts,
  -- tickets or account activation. Old delivery-job metadata is not a backup.
  delete from public.devfit_notification_outbox where id in (
    select id from public.devfit_notification_outbox where state='sent' and finished_at<now()-interval '30 days'
    order by finished_at for update skip locked limit 100);
  delete from public.devfit_sessions where session_hash in (
    select session_hash from public.devfit_sessions where expires_at<now()
    order by expires_at for update skip locked limit 100);
  -- One credential/route probe at rollout, even without any customer work.
  -- Once it succeeds, an empty queue creates no outbound requests.
  if not exists(select 1 from public.devfit_notification_outbox where state in ('pending','leased')
    and next_attempt_at<=now() and (lease_until is null or lease_until<=now()))
    and exists(select 1 from public.devfit_job_auth where name='notifications' and last_worker_at is not null) then return;end if;
  -- Do not enqueue overlapping HTTP callbacks while Vercel is unavailable.
  if not exists(select 1 from public.devfit_job_auth where name='notifications'
    and (last_dispatch_at is null or last_dispatch_at<now()-interval '4 minutes') for update skip locked) then return;end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='devfit_notification_job';
  if v_secret is null then raise exception 'notification job credential unavailable';end if;
  perform net.http_post(
    url:='https://devfitportal.vercel.app/api/admin',
    headers:=jsonb_build_object('Content-Type','application/json','x-devfit-job',v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=60000);
  update public.devfit_job_auth set last_dispatch_at=now() where name='notifications';
end;$$;
revoke all on function public.dispatch_devfit_notifications() from public,anon,authenticated,service_role;

do $$ declare v_secret text;begin
  if to_regclass('public.devfit_scale_environment') is not null then return;end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='devfit_notification_job';
  if v_secret is null then
    v_secret:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'devfit_notification_job','Private owner-notification worker capability');
  end if;
  insert into public.devfit_job_auth(name,token_hash,enabled)
    values('notifications',encode(extensions.digest(v_secret,'sha256'),'hex'),true)
    on conflict(name) do update set token_hash=excluded.token_hash,enabled=true;
  -- Cron history contains no key; the token is resolved from Vault at execution.
  perform cron.schedule('devfit-notification-retries','*/5 * * * *','select public.dispatch_devfit_notifications()');
  perform public.dispatch_devfit_notifications();
end;$$;
