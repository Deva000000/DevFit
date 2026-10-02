-- Additive incremental transport. Canonical documents remain compatible with
-- old installed clients, account deletion, owner recovery and existing reports.
-- Only server-side functions can read or mutate account data.
create or replace function public.load_devfit_account_delta(
  p_email text,p_data_type text,p_versions jsonb,p_security_context jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare v_security jsonb;v_approved boolean;v_rows jsonb;v_allowed boolean;v_retry integer;
begin
  if p_data_type is not null and p_data_type not in ('progress','nutrition','workouts','prefs') then
    return jsonb_build_object('status','invalid');
  end if;
  if p_security_context is not null then
    v_security := public.check_devfit_security_access(p_email,p_security_context->>'deviceId',
      p_security_context->>'ipHash',p_security_context->>'userAgent','/api/data',false,false,true);
    if v_security->>'status'<>'ok' then return v_security||jsonb_build_object('securityDenied',true); end if;
  end if;
  select approved into v_approved from public.devfit_subscribers where email=lower(trim(p_email));
  if not found or v_approved is not true then return jsonb_build_object('status','revoked'); end if;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit(
    'data_read:'||encode(digest(lower(trim(p_email)),'sha256'),'hex'),600,60);
  if not v_allowed then return jsonb_build_object('status','rate_limited','retryAfter',v_retry); end if;
  -- Compare the exact server-issued JSON timestamp string. Never trust a client
  -- version as authorization, nor return an empty account for an unavailable DB.
  select coalesce(jsonb_agg(case
    when (p_versions->>d.data_type) = (to_jsonb(d.updated_at)#>>'{}') then
      jsonb_build_object('data_type',d.data_type,'updated_at',d.updated_at,'notModified',true)
    else jsonb_build_object('data_type',d.data_type,'updated_at',d.updated_at,'data',d.data)
    end order by d.data_type),'[]'::jsonb) into v_rows
  from public.devfit_data d where d.email=lower(trim(p_email))
    and (p_data_type is null or d.data_type=p_data_type);
  return jsonb_build_object('status','ok','rows',v_rows);
end;
$$;
revoke all on function public.load_devfit_account_delta(text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.load_devfit_account_delta(text,text,jsonb,jsonb) to service_role;

create or replace function public.patch_devfit_data_atomic(
  p_email text,p_data_type text,p_changes jsonb,p_base_updated_at text,
  p_device_id text,p_ip_hash text,p_security_context jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare
  v_existing public.devfit_data%rowtype;v_data jsonb;v_change jsonb;v_path text[];
  v_security jsonb;v_base timestamptz;v_approved boolean;v_allowed boolean;v_retry integer;
  v_parent jsonb;v_segment text;v_i integer;v_index numeric;
begin
  if p_data_type is null or p_data_type not in ('progress','nutrition','workouts','prefs')
    or jsonb_typeof(p_changes) is distinct from 'array' then
    return jsonb_build_object('status','invalid');
  end if;
  if jsonb_array_length(p_changes)>128 or pg_column_size(p_changes)>131072 then
    return jsonb_build_object('status','invalid');
  end if;
  if p_security_context is not null then
    if p_security_context->>'deviceId' is distinct from p_device_id
      or p_security_context->>'ipHash' is distinct from p_ip_hash then
      return jsonb_build_object('status','invalid_device','securityDenied',true);
    end if;
    v_security := public.check_devfit_security_access(p_email,p_device_id,p_ip_hash,
      p_security_context->>'userAgent','/api/data',false,false,true);
    if v_security->>'status'<>'ok' then return v_security||jsonb_build_object('securityDenied',true); end if;
  end if;
  select approved into v_approved from public.devfit_subscribers where email=lower(trim(p_email));
  if not found or v_approved is not true then return jsonb_build_object('status','revoked'); end if;
  -- Invalid/conflicting patch attempts must also have a bounded account quota.
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit(
    'data_patch:'||encode(digest(lower(trim(p_email)),'sha256'),'hex'),1200,3600);
  if not v_allowed then return jsonb_build_object('status','rate_limited','retryAfter',v_retry); end if;
  perform pg_advisory_xact_lock(hashtextextended('devfit-save:'||lower(trim(p_email))||':'||p_data_type,0));
  select * into v_existing from public.devfit_data
    where email=lower(trim(p_email)) and data_type=p_data_type for update;
  if not found then return jsonb_build_object('status','conflict','row',null); end if;
  begin v_base := nullif(p_base_updated_at,'')::timestamptz;
  exception when others then v_base := null; end;
  if v_base is null or v_existing.updated_at<>v_base then
    return jsonb_build_object('status','conflict','row',jsonb_build_object(
      'data_type',v_existing.data_type,'data',v_existing.data,'updated_at',v_existing.updated_at));
  end if;
  v_data := v_existing.data;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) is distinct from 'object'
      or v_change->>'op' is null or v_change->>'op' not in ('set','remove')
      or jsonb_typeof(v_change->'path') is distinct from 'array' then
      return jsonb_build_object('status','invalid');
    end if;
    if jsonb_array_length(v_change->'path')<1 or jsonb_array_length(v_change->'path')>12
      or exists(select 1 from jsonb_array_elements(v_change->'path') x(value)
        where jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>180
          or x.value#>>'{}' in ('__proto__','prototype','constructor')) then
      return jsonb_build_object('status','invalid');
    end if;
    select array_agg(value order by ord) into v_path
      from jsonb_array_elements_text(v_change->'path') with ordinality p(value,ord);
    v_parent := v_data;
    for v_i in 1..cardinality(v_path) loop
      v_segment := v_path[v_i];
      if jsonb_typeof(v_parent)='array' then
        if v_segment !~ '^(0|[1-9][0-9]{0,9})$' then return jsonb_build_object('status','invalid'); end if;
        v_index := v_segment::numeric;
        if v_index>jsonb_array_length(v_parent) or
          (v_index=jsonb_array_length(v_parent) and (v_i<cardinality(v_path) or v_change->>'op'='remove')) then
          return jsonb_build_object('status','invalid');
        end if;
      elsif jsonb_typeof(v_parent) is distinct from 'object' then
        return jsonb_build_object('status','invalid');
      end if;
      if v_i<cardinality(v_path) then v_parent := case when jsonb_typeof(v_parent)='array'
          then v_parent->(v_segment::integer) else v_parent->v_segment end;
        if v_parent is null then return jsonb_build_object('status','invalid'); end if;
      end if;
    end loop;
    if v_change->>'op'='remove' then v_data := v_data #- v_path;
    else
      if not (v_change ? 'value') then return jsonb_build_object('status','invalid'); end if;
      v_data := jsonb_set(v_data,v_path,v_change->'value',true);
    end if;
  end loop;
  -- A repeated set-field patch after a lost response is harmless. For structural
  -- operations (array append/remove) require the original version: replaying
  -- them on a newer version could delete/append a different record.
  return public.save_devfit_data_atomic(p_email,p_data_type,v_data,p_base_updated_at,p_device_id,p_ip_hash);
end;
$$;
revoke all on function public.patch_devfit_data_atomic(text,text,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.patch_devfit_data_atomic(text,text,jsonb,text,text,text,jsonb) to service_role;

-- A read-only transport probe used by the existing health route. This proves
-- PostgREST can find all new named RPCs without accessing customer documents.
create or replace function public.devfit_sync_health()
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_read jsonb;v_patch jsonb;
begin
  v_read := public.load_devfit_account_delta('',null,'{}'::jsonb,null);
  v_patch := public.patch_devfit_data_atomic('','prefs','[]'::jsonb,'','', '',null);
  return jsonb_build_object('ok',v_read->>'status'='revoked' and v_patch->>'status'='revoked','syncProtocol',2);
end;
$$;
revoke all on function public.devfit_sync_health() from public,anon,authenticated;
grant execute on function public.devfit_sync_health() to service_role;
notify pgrst,'reload schema';
