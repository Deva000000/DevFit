-- DevFit production reliability hardening.
-- Current customer documents in devfit_data are never deleted by this migration.

create index if not exists devfit_rate_reset_at_idx
  on public.devfit_rate (reset_at);

create or replace function public.consume_devfit_rate_limit(
  p_id text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after integer, current_hits integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_reset bigint;
  v_hits integer;
begin
  if p_id is null or length(p_id) < 1 or length(p_id) > 180 then
    raise exception 'invalid rate-limit id';
  end if;
  if p_limit < 1 or p_limit > 100000 or p_window_seconds < 1 or p_window_seconds > 2678400 then
    raise exception 'invalid rate-limit window';
  end if;

  -- Keep stale IP buckets from accumulating over years. The indexed, bounded
  -- batch makes cleanup cheap even under normal request traffic.
  delete from public.devfit_rate
  where id in (
    select r.id from public.devfit_rate r
    where r.reset_at < v_now - 86400
    order by r.reset_at
    limit 25
  );

  insert into public.devfit_rate as r (id, hits, reset_at)
  values (p_id, 1, v_now + p_window_seconds)
  on conflict (id) do update
  set hits = case when r.reset_at <= v_now then 1 else r.hits + 1 end,
      reset_at = case when r.reset_at <= v_now then v_now + p_window_seconds else r.reset_at end
  returning r.hits, r.reset_at into v_hits, v_reset;

  return query select v_hits <= p_limit,
                      greatest(0, v_reset - v_now)::integer,
                      v_hits;
end;
$$;

revoke all on function public.consume_devfit_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_devfit_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_devfit_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_devfit_rate_limit(text, integer, integer) to service_role;

create index if not exists devfit_data_versions_account_time_idx
  on public.devfit_data_versions (email, data_type, created_at desc, id desc);

create or replace function public.archive_devfit_data_version(
  p_email text,
  p_data_type text,
  p_data jsonb,
  p_content_hash text,
  p_source_device text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_pruned integer := 0;
begin
  if p_email is null or position('@' in p_email) < 2 then raise exception 'invalid email'; end if;
  if p_data_type not in ('progress', 'nutrition', 'workouts', 'prefs') then raise exception 'invalid data type'; end if;
  if p_data is null or p_content_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid snapshot'; end if;

  -- One snapshot per document per six hours is enough for recovery and prevents
  -- normal autosaves from creating hundreds of near-identical rows per user.
  if not exists (
    select 1 from public.devfit_data_versions v
    where v.email = lower(p_email)
      and v.data_type = p_data_type
      and v.created_at > now() - interval '6 hours'
  ) then
    insert into public.devfit_data_versions
      (email, data_type, data, content_hash, source_device)
    values
      (lower(p_email), p_data_type, p_data, p_content_hash, left(coalesce(p_source_device, 'unknown'), 80))
    on conflict (email, data_type, content_hash) do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  -- Retain the eight newest recovery points per account/document. The live row
  -- remains in devfit_data and is not part of this pruning operation.
  with stale as (
    select id from public.devfit_data_versions
    where email = lower(p_email) and data_type = p_data_type
    order by created_at desc, id desc
    offset 8
  )
  delete from public.devfit_data_versions v using stale s where v.id = s.id;
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('inserted', v_inserted = 1, 'pruned', v_pruned);
end;
$$;

revoke all on function public.archive_devfit_data_version(text, text, jsonb, text, text) from public;
revoke all on function public.archive_devfit_data_version(text, text, jsonb, text, text) from anon;
revoke all on function public.archive_devfit_data_version(text, text, jsonb, text, text) from authenticated;
grant execute on function public.archive_devfit_data_version(text, text, jsonb, text, text) to service_role;

create or replace function public.record_devfit_error(
  p_type text,
  p_message text,
  p_stack text default '',
  p_src text default '',
  p_page text default '',
  p_ua text default '',
  p_status integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_pruned integer := 0;
  v_pruned_extra integer := 0;
begin
  insert into public.devfit_errors (type, message, stack, src, page, ua, status, at)
  values (
    left(coalesce(p_type, 'server'), 20), left(coalesce(p_message, ''), 500),
    left(coalesce(p_stack, ''), 1500), left(coalesce(p_src, ''), 200),
    left(coalesce(p_page, ''), 120), left(coalesce(p_ua, ''), 200),
    p_status, now()
  ) returning id into v_id;

  -- Amortise cleanup: cap at roughly 5,000 rows and 30 days without adding a
  -- delete query to every error path during an incident spike.
  if mod(v_id, 100) = 0 then
    delete from public.devfit_errors where at < now() - interval '30 days';
    get diagnostics v_pruned = row_count;
    with stale as (
      select id from public.devfit_errors order by at desc, id desc offset 5000
    )
    delete from public.devfit_errors e using stale s where e.id = s.id;
    get diagnostics v_pruned_extra = row_count;
    v_pruned := v_pruned + v_pruned_extra;
  end if;

  return jsonb_build_object('id', v_id, 'pruned', v_pruned);
end;
$$;

revoke all on function public.record_devfit_error(text, text, text, text, text, text, integer) from public;
revoke all on function public.record_devfit_error(text, text, text, text, text, text, integer) from anon;
revoke all on function public.record_devfit_error(text, text, text, text, text, text, integer) from authenticated;
grant execute on function public.record_devfit_error(text, text, text, text, text, text, integer) to service_role;

-- One-time cleanup of redundant internal recovery snapshots. Current customer
-- data is in devfit_data and is deliberately excluded.
with ranked as (
  select id,
         row_number() over (partition by email, data_type order by created_at desc, id desc) as rn
  from public.devfit_data_versions
)
delete from public.devfit_data_versions v using ranked r
where v.id = r.id and r.rn > 8;
