-- Dates identify the calendar meaning of every week. Existing programs may
-- change duration/goals, but a different start date requires a new program ID.
create or replace function public.devfit_progress_anchors_valid(p_next jsonb,p_before jsonb)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_program jsonb; v_match jsonb; v_active jsonb;
begin
  if coalesce(p_next->>'progressSchema','')<>'2' then
    return coalesce(p_before->>'progressSchema','')<>'2';
  end if;
  if jsonb_typeof(p_next->'programs') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_next->'programs')=0 then return false; end if;
  if exists(select 1 from jsonb_array_elements(p_next->'programs') p
       where coalesce(p->>'id','')='' or coalesce(p->>'start','') !~ '^\d{4}-\d{2}-\d{2}$')
     or (select count(*) from jsonb_array_elements(p_next->'programs'))<>
        (select count(distinct p->>'id') from jsonb_array_elements(p_next->'programs') p) then return false; end if;
  select p into v_active from jsonb_array_elements(p_next->'programs') p where p->>'id'=p_next->>'activeProgramId';
  if v_active is null or v_active->>'start' is distinct from p_next->>'programStart' then return false; end if;
  if coalesce(p_before->>'progressSchema','')<>'2' then return true; end if;
  -- Explicit account-data resets deliberately create a fresh timeline.
  if coalesce(p_next->>'resetAt','')<>coalesce(p_before->>'resetAt','') then
    begin
      if (p_next->>'resetAt')::timestamptz>coalesce(nullif(p_before->>'resetAt','')::timestamptz,'epoch'::timestamptz)
         and (p_next->>'resetAt')::timestamptz<=now()+interval '5 minutes' then return true; end if;
    exception when others then return false; end;
  end if;
  for v_program in select p from jsonb_array_elements(p_before->'programs') p loop
    select p into v_match from jsonb_array_elements(p_next->'programs') p where p->>'id'=v_program->>'id';
    if v_match is null or v_match->>'start' is distinct from v_program->>'start' then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.devfit_progress_anchors_valid(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.devfit_progress_anchors_valid(jsonb,jsonb) to service_role;

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
  perform pg_advisory_xact_lock(hashtextextended('devfit-save:'||v_email||':'||p_data_type,0));
  select * into v_existing from public.devfit_data where email=v_email and data_type=p_data_type for update;
  if found and v_existing.data=p_data then
    return jsonb_build_object('status','ok','unchanged',true,'updated_at',v_existing.updated_at);
  end if;
  v_account_hash := encode(digest(v_email,'sha256'),'hex');
  v_shard := (get_byte(digest(v_email,'sha256'),0) % 64)::text;
  select allowed,retry_after into v_allowed,v_retry
    from public.consume_devfit_rate_limit('data_user:'||v_account_hash,1200,3600);
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
  end if;
  if p_data_type='progress' and not public.devfit_progress_anchors_valid(p_data,v_existing.data) then
    if v_existing.email is null then return jsonb_build_object('status','invalid'); end if;
    return jsonb_build_object('status','conflict','reason','program_dates_locked','row',jsonb_build_object(
      'data_type',v_existing.data_type,'data',v_existing.data,'updated_at',v_existing.updated_at));
  end if;
  if v_existing.email is not null then
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
