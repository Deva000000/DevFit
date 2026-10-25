-- Rollback-only LOCAL test doubles for managed Vault / pg_net / pg_cron.
-- Verifies dispatch and housekeeping logic; not a managed-extension load test.
begin;
do $$ begin
  assert current_database() like 'devfit_scale%';
  assert exists(select 1 from public.devfit_scale_environment);
end;$$;
create schema vault;
create schema net;
create schema cron;
create table cron.job(jobid bigint primary key,jobname text);
create table cron.job_run_details(runid bigint primary key,jobid bigint,end_time timestamptz);
create view vault.decrypted_secrets as select 'devfit_notification_job'::text name,repeat('d',64) decrypted_secret;
create table public.devfit_scale_http_capture(url text,headers jsonb,body jsonb,timeout_ms integer);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language plpgsql as $$ begin
  insert into public.devfit_scale_http_capture values(url,headers,body,timeout_milliseconds);return 1;
end;$$;
do $$ declare v_ticket uuid:=gen_random_uuid();begin
  insert into cron.job values(1,'devfit-notification-retries'),(2,'unrelated-job');
  insert into cron.job_run_details values(1,1,now()-interval '8 days'),(2,2,now()-interval '8 days');
  insert into public.devfit_job_auth(name,token_hash,enabled)
    values('notifications',encode(extensions.digest(repeat('d',64),'sha256'),'hex'),true);
  perform public.dispatch_devfit_notifications();
  assert (select count(*)=1 from public.devfit_scale_http_capture),'Rollout probe exercises credential and route without customer work';
  update public.devfit_job_auth set last_worker_at=now(),last_dispatch_at=null;
  delete from public.devfit_scale_http_capture;
  perform public.dispatch_devfit_notifications();
  assert (select count(*)=0 from public.devfit_scale_http_capture),'After rollout, no HTTP polling for an empty queue';
  assert not exists(select 1 from cron.job_run_details where runid=1),'Only old job diagnostics cleaned';
  assert exists(select 1 from cron.job_run_details where runid=2),'Unrelated diagnostics untouched';
  insert into public.devfit_support_requests(id,email,whatsapp,category,message)
    values(v_ticket,'scheduler-probe@example.invalid','60123456789','feedback','Synthetic scheduler test');
  update public.devfit_notification_outbox set next_attempt_at=now()-interval '1 second' where support_id=v_ticket;
  perform public.dispatch_devfit_notifications();
  assert (select count(*)=1 from public.devfit_scale_http_capture);
  assert (select url='https://devfitportal.vercel.app/api/admin' and headers->>'x-devfit-job'=repeat('d',64)
    and body='{}'::jsonb and timeout_ms=60000 from public.devfit_scale_http_capture),'Fixed destination, credential, no customer payload';
  perform public.dispatch_devfit_notifications();
  assert (select count(*)=1 from public.devfit_scale_http_capture),'No overlapping callback';
  update public.devfit_job_auth set enabled=false,last_dispatch_at=null;
  perform public.dispatch_devfit_notifications();
  assert (select count(*)=1 from public.devfit_scale_http_capture),'Kill switch prevents dispatch';
  assert not has_function_privilege('service_role','public.dispatch_devfit_notifications()','EXECUTE');
  raise notice 'Scheduler destination, Vault capability, bounded diagnostics cleanup and kill switch checks passed';
end;$$;
rollback;
