-- Private public-food cache; never stores diary entries, account tokens or keys.
create table public.devfit_food_cache (
  cache_key text primary key check(length(cache_key)<=160),
  items jsonb check(items is null or jsonb_typeof(items)='array'),
  fetched_at timestamptz,
  fresh_until timestamptz not null default 'epoch',
  retry_at timestamptz not null default 'epoch',
  lease_id uuid,
  lease_until timestamptz not null default 'epoch',
  touched_at timestamptz not null default now()
);
alter table public.devfit_food_cache enable row level security;
revoke all on public.devfit_food_cache from public,anon,authenticated;
grant all on public.devfit_food_cache to service_role;

-- One network round-trip for current account access, device checks and quotas.
create or replace function public.authorize_devfit_food_search(
  p_email text,p_device_id text,p_ip_hash text,p_bound boolean,p_user_agent text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_email text:=lower(trim(p_email));v_security jsonb;v_account text;v_shard text;
  v_allowed boolean;v_retry integer;v_ip_allowed boolean;v_ip_retry integer;
begin
  if not exists(select 1 from public.devfit_subscribers where email=v_email and approved is true) then
    return jsonb_build_object('status','account_unavailable');end if;
  if p_bound then
    v_security:=public.check_devfit_security_access(v_email,p_device_id,p_ip_hash,p_user_agent,'/api/food-search',false,false,true);
    if v_security->>'status'<>'ok' then return jsonb_build_object('status','account_unavailable');end if;
  end if;
  v_account:=encode(digest(v_email,'sha256'),'hex');v_shard:=(get_byte(digest(v_email,'sha256'),0)%32)::text;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit('food_account:'||v_account,90,60);
  -- Per-account limit is primary. Shared Wi-Fi/carrier users must not all share
  -- a 900-call ceiling. Provider budgets below are separate and global.
  select allowed,retry_after into v_ip_allowed,v_ip_retry from public.consume_devfit_rate_limit('food_ip:'||left(p_ip_hash,64)||':'||v_shard,900,60);
  if not v_allowed or not v_ip_allowed then return jsonb_build_object('status','rate_limited','retryAfter',greatest(v_retry,v_ip_retry,1));end if;
  return jsonb_build_object('status','ok');
end;$$;
revoke all on function public.authorize_devfit_food_search(text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.authorize_devfit_food_search(text,text,text,boolean,text) to service_role;

create or replace function public.claim_devfit_food_cache(p_key text,p_provider text,p_limit integer,p_window integer)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_row public.devfit_food_cache%rowtype;v_allowed boolean;v_retry integer;v_lease uuid;v_count integer;
begin
  if p_provider is null or p_key is null or p_limit is null or p_window is null
    or p_provider not in ('off','usda','kalori') or p_key !~ '^[a-z0-9:_-]{1,160}$'
    or p_limit not between 1 and 1000 or p_window not between 60 and 86400 then return jsonb_build_object('status','invalid');end if;
  select * into v_row from public.devfit_food_cache where cache_key=p_key;
  if found and v_row.fresh_until>now() then return jsonb_build_object('status','cached','items',v_row.items);end if;
  if v_row.fetched_at<now()-interval '30 days' then v_row.items:=null;end if;
  if v_row.retry_at>now() or v_row.lease_until>now() then
    return jsonb_build_object('status','busy','items',v_row.items,'retryAfter',2);end if;
  if not pg_try_advisory_xact_lock(hashtextextended('food-cache:'||p_key,0)) then
    return jsonb_build_object('status','busy','items',v_row.items,'retryAfter',2);end if;
  -- Recheck after acquiring the key lock; only one instance may fetch this key.
  select * into v_row from public.devfit_food_cache where cache_key=p_key;
  if found and v_row.fresh_until>now() then return jsonb_build_object('status','cached','items',v_row.items);end if;
  if v_row.fetched_at<now()-interval '30 days' then v_row.items:=null;end if;
  if v_row.retry_at>now() or v_row.lease_until>now() then return jsonb_build_object('status','busy','items',v_row.items,'retryAfter',2);end if;
  select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit('food_provider:'||p_provider,p_limit,p_window);
  if not v_allowed then return jsonb_build_object('status','limited','items',v_row.items,'retryAfter',v_retry);end if;
  if p_provider='usda' and p_limit<100 then
    select allowed,retry_after into v_allowed,v_retry from public.consume_devfit_rate_limit('food_provider:usda-demo-day',44,86400);
    if not v_allowed then return jsonb_build_object('status','limited','items',v_row.items,'retryAfter',v_retry);end if;
  end if;
  if v_row.cache_key is null then
    -- Bound cache disk usage; this lock is used only for new keys, not reads.
    perform pg_advisory_xact_lock(hashtextextended('food-cache-capacity',0));
    select count(*) into v_count from public.devfit_food_cache;
    if v_count>=512 then
      delete from public.devfit_food_cache where cache_key in(select cache_key from public.devfit_food_cache where lease_until<now() order by touched_at limit 1);
      if not found then return jsonb_build_object('status','busy','items',null,'retryAfter',2);end if;
    end if;
    insert into public.devfit_food_cache(cache_key) values(p_key);
  end if;
  v_lease:=gen_random_uuid();
  update public.devfit_food_cache set lease_id=v_lease,lease_until=now()+interval '30 seconds',touched_at=now() where cache_key=p_key;
  return jsonb_build_object('status','fetch','lease',v_lease,'items',v_row.items);
end;$$;
revoke all on function public.claim_devfit_food_cache(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_devfit_food_cache(text,text,integer,integer) to service_role;

create or replace function public.finish_devfit_food_cache(p_key text,p_lease uuid,p_items jsonb,p_success boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_success and (jsonb_typeof(p_items) is distinct from 'array' or pg_column_size(p_items)>65536) then
    return jsonb_build_object('ok',false);end if;
  if p_success and jsonb_array_length(p_items)>60 then return jsonb_build_object('ok',false);end if;
  update public.devfit_food_cache set
    items=case when p_success then p_items else items end,
    fetched_at=case when p_success then now() else fetched_at end,
    fresh_until=case when p_success then now()+case when jsonb_array_length(p_items)=0 then interval '5 minutes' else interval '1 day' end else fresh_until end,
    retry_at=case when p_success then 'epoch'::timestamptz else now()+interval '2 minutes' end,
    lease_id=null,lease_until='epoch',touched_at=now()
    where cache_key=p_key and lease_id=p_lease;
  return jsonb_build_object('ok',found);
end;$$;
revoke all on function public.finish_devfit_food_cache(text,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_devfit_food_cache(text,uuid,jsonb,boolean) to service_role;
