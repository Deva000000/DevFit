-- Scale hardening. No customer documents or recovery points are removed.
-- All helpers remain private to the server service role.
create or replace function public.devfit_record_date(p_value text)
returns date language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p_value::date;
exception when datetime_field_overflow or invalid_datetime_format then
  return null;
end;
$$;
revoke all on function public.devfit_record_date(text) from public, anon, authenticated;
grant execute on function public.devfit_record_date(text) to service_role;

create or replace function public.sync_devfit_records(p_email text, p_data_type text, p_data jsonb)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- Filter before ON CONFLICT: unchanged history does not take row locks,
  -- produce WAL or accumulate dead tuples on each keystroke save.
  if p_data_type = 'nutrition' and jsonb_typeof(p_data->'days') = 'object' then
    insert into public.devfit_records (email,data_type,record_key,occurred_on,data,updated_at)
    select lower(p_email),'nutrition_day',e.key,public.devfit_record_date(e.key),e.value,clock_timestamp()
    from jsonb_each(p_data->'days') e
    left join public.devfit_records r on r.email=lower(p_email)
      and r.data_type='nutrition_day' and r.record_key=e.key
    where r.record_key is null or r.data is distinct from e.value
      or r.occurred_on is distinct from public.devfit_record_date(e.key)
    on conflict (email,data_type,record_key) do update
      set occurred_on=excluded.occurred_on,data=excluded.data,updated_at=excluded.updated_at
      where devfit_records.data is distinct from excluded.data
         or devfit_records.occurred_on is distinct from excluded.occurred_on;
  elsif p_data_type = 'workouts' and jsonb_typeof(p_data->'sessions') = 'array' then
    with entries as (
      select left(coalesce(nullif(s.value->>'id',''),
        coalesce(s.value->>'date','unknown')||'|'||coalesce(s.value->>'workoutId','unknown')||'|'||s.ord::text),180) key,
        public.devfit_record_date(s.value->>'date') record_date,s.value data,s.ord
      from jsonb_array_elements(p_data->'sessions') with ordinality s(value,ord)
    ), unique_entries as (
      select distinct on (key) key,record_date,data from entries order by key,ord desc
    )
    insert into public.devfit_records (email,data_type,record_key,occurred_on,data,updated_at)
    select lower(p_email),'workout_session',e.key,e.record_date,e.data,clock_timestamp()
    from unique_entries e
    left join public.devfit_records r on r.email=lower(p_email)
      and r.data_type='workout_session' and r.record_key=e.key
    where r.record_key is null or r.data is distinct from e.data or r.occurred_on is distinct from e.record_date
    on conflict (email,data_type,record_key) do update
      set occurred_on=excluded.occurred_on,data=excluded.data,updated_at=excluded.updated_at
      where devfit_records.data is distinct from excluded.data
         or devfit_records.occurred_on is distinct from excluded.occurred_on;
  elsif p_data_type = 'progress' and jsonb_typeof(p_data->'programs') = 'array' then
    with entries as (
      select left(coalesce(nullif(p.program->>'id',''),'legacy')||':'||n.week_index::text,180) key,
        public.devfit_record_date(p.program->>'programStart')+(n.week_index*7) record_date,
        jsonb_build_object('programId',p.program->>'id','weekIndex',n.week_index,
          'bw',coalesce(p.program->'bw'->n.week_index,'[]'::jsonb),
          'steps',coalesce(p.program->'steps'->n.week_index,'[]'::jsonb),
          'sleep',coalesce(p.program->'sleep'->n.week_index,'[]'::jsonb),
          'checkin',coalesce(p.program->'weeklyCheckin'->n.week_index,'{}'::jsonb)) data,p.ord
      from jsonb_array_elements(p_data->'programs') with ordinality p(program,ord)
      cross join lateral generate_series(0,greatest(
        case when jsonb_typeof(p.program->'bw')='array' then jsonb_array_length(p.program->'bw') else 0 end,
        case when jsonb_typeof(p.program->'steps')='array' then jsonb_array_length(p.program->'steps') else 0 end,
        case when jsonb_typeof(p.program->'sleep')='array' then jsonb_array_length(p.program->'sleep') else 0 end,
        case when jsonb_typeof(p.program->'weeklyCheckin')='array' then jsonb_array_length(p.program->'weeklyCheckin') else 0 end)-1) n(week_index)
    ), unique_entries as (
      select distinct on (key) key,record_date,data from entries order by key,ord desc
    )
    insert into public.devfit_records (email,data_type,record_key,occurred_on,data,updated_at)
    select lower(p_email),'progress_week',e.key,e.record_date,e.data,clock_timestamp()
    from unique_entries e
    left join public.devfit_records r on r.email=lower(p_email)
      and r.data_type='progress_week' and r.record_key=e.key
    where r.record_key is null or r.data is distinct from e.data or r.occurred_on is distinct from e.record_date
    on conflict (email,data_type,record_key) do update
      set occurred_on=excluded.occurred_on,data=excluded.data,updated_at=excluded.updated_at
      where devfit_records.data is distinct from excluded.data
         or devfit_records.occurred_on is distinct from excluded.occurred_on;
  end if;
end;
$$;
revoke all on function public.sync_devfit_records(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.sync_devfit_records(text,text,jsonb) to service_role;

create or replace function public.consume_devfit_rate_limit(p_id text,p_limit integer,p_window_seconds integer)
returns table (allowed boolean,retry_after integer,current_hits integer)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_reset bigint; v_hits integer;
begin
  if p_id is null or length(p_id)<1 or length(p_id)>180 then raise exception 'invalid rate-limit id'; end if;
  if p_limit<1 or p_limit>100000 or p_window_seconds<1 or p_window_seconds>2678400 then
    raise exception 'invalid rate-limit window';
  end if;
  insert into public.devfit_rate as r (id,hits,reset_at)
  values (p_id,1,v_now+p_window_seconds)
  on conflict (id) do update
    set hits=case when r.reset_at<=v_now then 1 else r.hits+1 end,
        reset_at=case when r.reset_at<=v_now then v_now+p_window_seconds else r.reset_at end
  returning r.hits,r.reset_at into v_hits,v_reset;
  -- Amortised, bounded cleanup. SKIP LOCKED prevents simultaneous requests
  -- waiting on the same expired buckets or reversing lock order.
  if mod(v_hits,128)=0 then
    delete from public.devfit_rate where id in (
      select id from public.devfit_rate where reset_at<v_now-86400
      order by reset_at limit 25 for update skip locked
    );
  end if;
  return query select v_hits<=p_limit,greatest(0,v_reset-v_now)::integer,v_hits;
end;
$$;
revoke all on function public.consume_devfit_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_devfit_rate_limit(text,integer,integer) to service_role;

create or replace function public.save_devfit_data_atomic(
  p_email text,p_data_type text,p_data jsonb,p_base_updated_at text,p_device_id text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_existing public.devfit_data%rowtype;
  v_base timestamptz; v_now timestamptz; v_approved boolean;
  v_allowed boolean; v_retry integer; v_ip_allowed boolean; v_ip_retry integer;
  v_account_hash text; v_shard text;
begin
  if position('@' in v_email)<2 or length(v_email)>254 or p_data_type is null
     or p_data_type not in ('progress','nutrition','workouts','prefs')
     or p_data is null or jsonb_typeof(p_data)<>'object' then
    return jsonb_build_object('status','invalid');
  end if;
  if pg_column_size(p_data)>(case p_data_type when 'progress' then 524288
       when 'nutrition' then 786432 when 'workouts' then 1048576 else 65536 end) then
    return jsonb_build_object('status','too_large');
  end if;
  select approved into v_approved from public.devfit_subscribers where email=v_email;
  if not found or v_approved is not true then return jsonb_build_object('status','revoked'); end if;
  -- Also serialises first writes when the document row does not exist yet.
  perform pg_advisory_xact_lock(hashtextextended('devfit-save:'||v_email||':'||p_data_type,0));
  select * into v_existing from public.devfit_data where email=v_email and data_type=p_data_type for update;
  if found and v_existing.data=p_data then
    return jsonb_build_object('status','ok','unchanged',true,'updated_at',v_existing.updated_at);
  end if;
  v_account_hash := encode(digest(v_email,'sha256'),'hex');
  v_shard := (get_byte(digest(v_email,'sha256'),0) % 64)::text;
  select allowed,retry_after into v_allowed,v_retry
    from public.consume_devfit_rate_limit('data_user:'||v_account_hash,1200,3600);
  -- 64 account-derived shards avoid one lock serialising an entire gym/NAT.
  -- Each shard has an emergency ceiling; the exact per-account quota is primary.
  -- Budget ~2,000 NAT users at up to 1,200 saves/h each plus hash skew; 6,000/h
  -- per shard would still block normal activity behind a busy carrier network.
  select allowed,retry_after into v_ip_allowed,v_ip_retry
    from public.consume_devfit_rate_limit('data_ip:'||left(coalesce(p_ip_hash,'unknown'),80)||':'||v_shard,60000,3600);
  if not v_allowed or not v_ip_allowed then
    return jsonb_build_object('status','rate_limited','retryAfter',greatest(v_retry,v_ip_retry,1));
  end if;
  if v_existing.email is not null then
    begin v_base := nullif(trim(coalesce(p_base_updated_at,'')),'')::timestamptz;
    exception when others then v_base := null; end;
    if v_base is null or v_existing.updated_at<>v_base then
      return jsonb_build_object('status','conflict','row',jsonb_build_object(
        'data_type',v_existing.data_type,'data',v_existing.data,'updated_at',v_existing.updated_at));
    end if;
    if not exists (select 1 from public.devfit_data_versions v where v.email=v_email
        and v.data_type=p_data_type and v.created_at>now()-interval '6 hours') then
      perform public.archive_devfit_data_version(v_email,p_data_type,v_existing.data,
        encode(digest(convert_to(v_existing.data::text,'UTF8'),'sha256'),'hex'),
        'server-before:'||left(coalesce(p_device_id,'unknown'),64));
    end if;
    v_now := greatest(clock_timestamp(),v_existing.updated_at+interval '1 microsecond');
    update public.devfit_data set data=p_data,updated_at=v_now where email=v_email and data_type=p_data_type;
  else
    v_now := clock_timestamp();
    insert into public.devfit_data(email,data_type,data,updated_at) values(v_email,p_data_type,p_data,v_now);
  end if;
  perform public.sync_devfit_records(v_email,p_data_type,p_data);
  return jsonb_build_object('status','ok','updated_at',v_now);
end;
$$;
revoke all on function public.save_devfit_data_atomic(text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.save_devfit_data_atomic(text,text,jsonb,text,text,text) to service_role;
create or replace function public.check_devfit_security_access(
  p_email text,
  p_device_id text,
  p_ip_hash text,
  p_user_agent text,
  p_route text,
  p_register boolean default false,
  p_is_login boolean default false,
  p_require_known boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_device text := trim(coalesce(p_device_id, ''));
  v_ip_hash text := lower(trim(coalesce(p_ip_hash, '')));
  v_account_hash text;
  v_device_hash text;
  v_existing public.devfit_logins%rowtype;
  v_active_devices integer := 0;
  v_status text := 'ok';
begin
  if v_email = '' or char_length(v_email) > 254 or position('@' in v_email) <= 1 then
    return jsonb_build_object('status', 'invalid_account');
  end if;
  if char_length(v_device) < 16 or char_length(v_device) > 80 then
    return jsonb_build_object('status', 'invalid_device');
  end if;
  if v_ip_hash <> '' and v_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  v_account_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');
  v_device_hash := encode(extensions.digest(v_device, 'sha256'), 'hex');

  if exists (
    select 1 from public.devfit_security_blocks
    where scope = 'account' and key_hash = v_account_hash and active
      and (expires_at is null or expires_at > now())
  ) then v_status := 'account_blocked';
  elsif exists (
    select 1 from public.devfit_security_blocks
    where scope = 'device' and key_hash = v_device_hash and active
      and (expires_at is null or expires_at > now())
  ) then v_status := 'device_blocked';
  elsif v_ip_hash <> '' and exists (
    select 1 from public.devfit_security_blocks
    where scope = 'ip' and key_hash = v_ip_hash and active
      and (expires_at is null or expires_at > now())
  ) then v_status := 'ip_blocked';
  end if;

  if v_status <> 'ok' then
    if not exists (
      select 1 from public.devfit_security_events
      where email = v_email and event_type = v_status and at > now() - interval '5 minutes'
    ) then
      insert into public.devfit_security_events
        (email, device_hash, ip_hash, event_type, severity, route, reason, blocked)
      values
        (v_email, v_device_hash, nullif(v_ip_hash, ''), v_status, 'high', left(coalesce(p_route,''),120),
         'Request denied by an active owner block', true);
    end if;
    return jsonb_build_object('status', v_status, 'deviceHash', v_device_hash);
  end if;

  -- Per-account registration lock closes the concurrent fourth-device race.
  if p_register then
    perform pg_advisory_xact_lock(hashtextextended('devfit-device:' || v_email, 0));
  end if;

  select * into v_existing from public.devfit_logins
    where email = v_email and device_id = v_device;

  if p_require_known and v_existing.email is null then
    return jsonb_build_object('status', 'unknown_device', 'deviceHash', v_device_hash);
  end if;

  select count(*) into v_active_devices from public.devfit_logins
    where email = v_email and last_seen >= now() - interval '45 days';

  -- Grandfather devices already used by an account. Only an additional new
  -- device is denied, so rollout never ejects a legitimate current device.
  if v_existing.email is null and p_register and v_active_devices >= 3 then
    if not exists (
      select 1 from public.devfit_security_events
      where email = v_email and device_hash = v_device_hash
        and event_type = 'device_limit' and at > now() - interval '30 minutes'
    ) then
      insert into public.devfit_security_events
        (email, device_hash, ip_hash, event_type, severity, route, reason, blocked)
      values
        (v_email, v_device_hash, nullif(v_ip_hash, ''), 'device_limit', 'high', left(coalesce(p_route,''),120),
         'A fourth active device attempted to use this account', true);
    end if;
    return jsonb_build_object('status', 'device_limit', 'deviceHash', v_device_hash,
      'activeDevices', v_active_devices, 'maxDevices', 3);
  end if;

  if p_register then
    insert into public.devfit_logins
      (email, device_id, user_agent, first_seen, last_seen, login_count)
    values
      (v_email, v_device, left(coalesce(p_user_agent,''),300), now(), now(), 1)
    on conflict (email, device_id) do update set
      user_agent = excluded.user_agent,
      last_seen = now(),
      login_count = public.devfit_logins.login_count + case when p_is_login then 1 else 0 end
    where p_is_login or public.devfit_logins.last_seen < now() - interval '15 minutes'
      or public.devfit_logins.user_agent is distinct from excluded.user_agent;
  elsif v_existing.email is not null and v_existing.last_seen < now() - interval '15 minutes' then
    -- Continued authenticated use keeps a persistent session active without
    -- requiring a fresh Google login or writing a heartbeat on every request.
    update public.devfit_logins set last_seen=now()
      where email=v_email and device_id=v_device
        and last_seen < now() - interval '15 minutes';
  end if;

  -- Retain useful security history without unlimited table growth.
  if p_is_login then
    delete from public.devfit_security_events where id in (
      select id from public.devfit_security_events
      where at < now() - interval '180 days' order by at limit 100 for update skip locked
    );
  end if;

  return jsonb_build_object('status', 'ok', 'deviceHash', v_device_hash,
    'activeDevices', case when v_existing.email is null and p_register then v_active_devices + 1 else v_active_devices end,
    'maxDevices', 3);
end;
$$;

revoke all on function public.check_devfit_security_access(text,text,text,text,text,boolean,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.check_devfit_security_access(text,text,text,text,text,boolean,boolean,boolean)
  to service_role;

-- Exact legacy signatures remain for already-installed clients. New bound
-- sessions send an explicit context and use these non-defaulted overloads.
create or replace function public.load_devfit_account(
  p_email text,p_data_type text,p_security_context jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare v_security jsonb;v_allowed boolean;v_retry integer;
begin
  if p_security_context is null or jsonb_typeof(p_security_context)<>'object' then
    return jsonb_build_object('status','invalid_device','securityDenied',true);
  end if;
  v_security := public.check_devfit_security_access(p_email,p_security_context->>'deviceId',
    p_security_context->>'ipHash',p_security_context->>'userAgent','/api/data',false,false,true);
  if v_security->>'status'<>'ok' then return v_security||jsonb_build_object('securityDenied',true); end if;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit(
    'data_read:'||encode(digest(lower(trim(p_email)),'sha256'),'hex'),600,60);
  if not v_allowed then return jsonb_build_object('status','rate_limited','retryAfter',v_retry); end if;
  return public.load_devfit_account(p_email,p_data_type);
end;
$$;
revoke all on function public.load_devfit_account(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.load_devfit_account(text,text,jsonb) to service_role;

create or replace function public.save_devfit_data_atomic(
  p_email text,p_data_type text,p_data jsonb,p_base_updated_at text,p_device_id text,p_ip_hash text,
  p_security_context jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare v_security jsonb;
begin
  if p_security_context is null or jsonb_typeof(p_security_context)<>'object' then
    return jsonb_build_object('status','invalid_device','securityDenied',true);
  end if;
  if p_security_context->>'deviceId' is distinct from p_device_id
      or p_security_context->>'ipHash' is distinct from p_ip_hash then
    return jsonb_build_object('status','invalid_device','securityDenied',true);
  end if;
  v_security := public.check_devfit_security_access(p_email,p_device_id,p_ip_hash,
    p_security_context->>'userAgent','/api/data',false,false,true);
  if v_security->>'status'<>'ok' then return v_security||jsonb_build_object('securityDenied',true); end if;
  return public.save_devfit_data_atomic(p_email,p_data_type,p_data,p_base_updated_at,p_device_id,p_ip_hash);
end;
$$;
revoke all on function public.save_devfit_data_atomic(text,text,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_devfit_data_atomic(text,text,jsonb,text,text,text,jsonb) to service_role;
