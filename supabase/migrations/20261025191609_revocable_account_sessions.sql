-- Additive: no diary, program, subscription or receipt data is rewritten.
set lock_timeout='3s';
set statement_timeout='20s';
alter table public.devfit_logins add column if not exists session_revoked_before timestamptz not null default 'epoch';
alter table public.devfit_subscribers add column if not exists sessions_revoked_before timestamptz not null default 'epoch';
create table public.devfit_sessions (
  session_hash text primary key check(session_hash ~ '^[0-9a-f]{64}$'),
  email text not null references public.devfit_subscribers(email) on delete cascade,
  device_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  foreign key(email,device_id) references public.devfit_logins(email,device_id) on delete cascade
);
create index devfit_sessions_email_device_idx on public.devfit_sessions(email,device_id);
alter table public.devfit_sessions enable row level security;
revoke all on public.devfit_sessions from public,anon,authenticated;
grant select on public.devfit_sessions to service_role;
create policy devfit_sessions_deny_browser on public.devfit_sessions for all to anon,authenticated using(false) with check(false);

create table public.devfit_session_rollout (
  id boolean primary key default true check(id),
  legacy_until timestamptz not null default now()+interval '7 days'
);
insert into public.devfit_session_rollout(id) values(true);
alter table public.devfit_session_rollout enable row level security;
revoke all on public.devfit_session_rollout from public,anon,authenticated;
grant select on public.devfit_session_rollout to service_role;
create policy devfit_session_rollout_deny_browser on public.devfit_session_rollout for all to anon,authenticated using(false) with check(false);

-- Only the API may call this AFTER verifying Google, or a signed legacy token
-- during the short rollout. An old token cannot register a new/reset device.
create function public.open_devfit_session(p_email text,p_device_id text,p_session_hash text,p_legacy_iat bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_login public.devfit_logins%rowtype;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','invalid_session');end if;
  select * into v_login from public.devfit_logins where email=p_email and device_id=p_device_id for update;
  if not found or not exists(select 1 from public.devfit_subscribers where email=p_email and approved is true) then
    return jsonb_build_object('status','revoked');end if;
  if p_legacy_iat is not null and (not exists(select 1 from public.devfit_session_rollout where legacy_until>now())
      or to_timestamp(p_legacy_iat)+interval '1 second'<v_login.first_seen
      or to_timestamp(p_legacy_iat)<=v_login.session_revoked_before
      or exists(select 1 from public.devfit_subscribers where email=p_email and sessions_revoked_before>=to_timestamp(p_legacy_iat))) then
    return jsonb_build_object('status','revoked');end if;
  delete from public.devfit_sessions where email=p_email and expires_at<=now();
  -- One current session per installation: a fresh Google login supersedes the
  -- old bearer token on that installation, without affecting other devices.
  if p_legacy_iat is null then delete from public.devfit_sessions where email=p_email and device_id=p_device_id;end if;
  insert into public.devfit_sessions(session_hash,email,device_id) values(p_session_hash,p_email,p_device_id)
    on conflict(session_hash) do nothing;
  return jsonb_build_object('status','ok');
end;$$;

create function public.authorize_devfit_session(p_email text,p_device_id text,p_session_hash text,p_ip_hash text,p_user_agent text,p_route text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_security jsonb;v_sub public.devfit_subscribers%rowtype;v_allowed boolean;v_retry integer;v_limit integer;
begin
  if p_session_hash is null or not exists(select 1 from public.devfit_sessions where session_hash=p_session_hash
      and email=p_email and device_id=p_device_id and expires_at>now()) then return jsonb_build_object('status','revoked');end if;
  v_security:=public.check_devfit_security_access(p_email,p_device_id,p_ip_hash,p_user_agent,p_route,false,false,true);
  if v_security->>'status'<>'ok' then return v_security;end if;
  select * into v_sub from public.devfit_subscribers where email=p_email and approved is true;
  if not found then return jsonb_build_object('status','revoked');end if;
  v_limit:=case p_route when '/api/pro-access' then 30 when '/api/verify' then 120 when '/api/food-search' then 90 else 240 end;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit(
    'session_request:'||encode(digest(p_email,'sha256'),'hex')||':'||left(p_route,40),v_limit,60);
  if not v_allowed then return jsonb_build_object('status','rate_limited','retryAfter',greatest(v_retry,1));end if;
  -- Activity tracking is sampled rather than updated on every keystroke.
  update public.devfit_logins set last_seen=now() where email=p_email and device_id=p_device_id and last_seen<now()-interval '5 minutes';
  return jsonb_build_object('status','ok','subscriber',jsonb_build_object(
    'email',v_sub.email,'name',v_sub.name,'tier',v_sub.tier,'approved',v_sub.approved,
    'expiry',v_sub.expiry,'start_date',v_sub.start_date,'plan',v_sub.plan));
end;$$;

create function public.revoke_devfit_session(p_email text,p_device_id text,p_session_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A logout also prevents replaying pre-migration tokens for this installation.
  update public.devfit_logins set session_revoked_before=now() where email=p_email and device_id=p_device_id;
  delete from public.devfit_sessions where email=p_email and device_id=p_device_id and session_hash=p_session_hash;
  return jsonb_build_object('status','ok');
end;$$;

revoke all on function public.open_devfit_session(text,text,text,bigint), public.authorize_devfit_session(text,text,text,text,text,text), public.revoke_devfit_session(text,text,text) from public,anon,authenticated;
grant execute on function public.open_devfit_session(text,text,text,bigint), public.authorize_devfit_session(text,text,text,text,text,text), public.revoke_devfit_session(text,text,text) to service_role;

-- Account revocation is irreversible for existing bearer tokens, even if the
-- owner later reactivates the subscription. Only a fresh Google login can issue
-- a new session. No diary/history rows are touched.
create function public.invalidate_devfit_sessions_on_revoke()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.approved is true and new.approved is not true then
    new.sessions_revoked_before:=now();
    delete from public.devfit_sessions where email=old.email;
  end if;
  return new;
end;$$;
revoke all on function public.invalidate_devfit_sessions_on_revoke() from public,anon,authenticated;
create trigger devfit_subscriber_session_revocation before update of approved on public.devfit_subscribers
  for each row execute function public.invalidate_devfit_sessions_on_revoke();

create or replace function public.reset_devfit_devices(p_email text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_email text:=lower(trim(coalesce(p_email,'')));v_count integer;
begin
  if v_email='' or position('@' in v_email)<=1 then raise exception 'invalid email';end if;
  -- Survives deletion/recreation of a login row, including a same-second reset.
  update public.devfit_subscribers set sessions_revoked_before=now() where email=v_email;
  delete from public.devfit_logins where email=v_email;
  get diagnostics v_count=row_count;
  insert into public.devfit_security_events(email,event_type,severity,route,reason,blocked)
    values(v_email,'devices_reset','info','/api/admin','Owner reset trusted devices and sessions',false);
  return v_count;
end;$$;
revoke all on function public.reset_devfit_devices(text) from public,anon,authenticated;
grant execute on function public.reset_devfit_devices(text) to service_role;

-- Close the legacy service-only food-authorization bypass too. New API code
-- uses authorize_devfit_session; old deployed instances must still check devices.
create or replace function public.authorize_devfit_food_search(p_email text,p_device_id text,p_ip_hash text,p_bound boolean,p_user_agent text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_security jsonb;v_allowed boolean;v_retry integer;
begin
  if not exists(select 1 from public.devfit_subscribers where email=lower(trim(p_email)) and approved is true) then
    return jsonb_build_object('status','account_unavailable');end if;
  v_security:=public.check_devfit_security_access(p_email,p_device_id,p_ip_hash,p_user_agent,'/api/food-search',false,false,true);
  if v_security->>'status'<>'ok' then return jsonb_build_object('status','account_unavailable');end if;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit(
    'food_account:'||encode(digest(lower(trim(p_email)),'sha256'),'hex'),90,60);
  if not v_allowed then return jsonb_build_object('status','rate_limited','retryAfter',greatest(v_retry,1));end if;
  return jsonb_build_object('status','ok');
end;$$;
