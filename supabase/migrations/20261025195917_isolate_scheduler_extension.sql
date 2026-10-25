-- pg_net is non-relocatable after creation. Correct the brand-new installation
-- to the unexposed extensions namespace without touching durable outbox jobs,
-- Vault secrets, customer records or any other extension. No CASCADE.
set lock_timeout='3s';
set statement_timeout='20s';
do $$ begin
  if to_regclass('public.devfit_scale_environment') is not null then return;end if;
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pg_net' and n.nspname<>'extensions') then
    if exists(select 1 from net.http_request_queue) then
      raise exception 'HTTP requests are still queued; retry extension isolation after they complete';end if;
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
  revoke all on schema net from public,anon,authenticated;
  revoke all on all tables in schema net from public,anon,authenticated;
  revoke all on all functions in schema net from public,anon,authenticated;
end;$$;
