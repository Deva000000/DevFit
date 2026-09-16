-- DevFit data-path hardening.
-- Additive and data-preserving: existing live documents and recovery versions
-- remain untouched. The API switches to these RPCs only after this migration.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.devfit_records (
  email text not null,
  data_type text not null,
  record_key text not null,
  occurred_on date,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (email, data_type, record_key),
  constraint devfit_records_type_check check (
    data_type in ('nutrition_day', 'workout_session', 'progress_week')
  )
);

alter table public.devfit_records enable row level security;

create index if not exists devfit_records_account_date_idx
  on public.devfit_records (email, data_type, occurred_on desc nulls last);

-- Build a row-oriented copy alongside the compatibility documents. This is the
-- safe first phase of the multi-year storage migration: old clients continue to
-- read the document while future clients can page individual days/weeks.
create or replace function public.sync_devfit_records(
  p_email text,
  p_data_type text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_data_type = 'nutrition' and jsonb_typeof(p_data->'days') = 'object' then
    insert into public.devfit_records (email, data_type, record_key, occurred_on, data, updated_at)
    select lower(p_email), 'nutrition_day', left(e.key, 180),
           case when e.key ~ '^\d{4}-\d{2}-\d{2}$' then e.key::date else null end,
           e.value, now()
    from jsonb_each(p_data->'days') e
    on conflict (email, data_type, record_key) do update
      set occurred_on = excluded.occurred_on,
          data = excluded.data,
          updated_at = excluded.updated_at;
  elsif p_data_type = 'workouts' and jsonb_typeof(p_data->'sessions') = 'array' then
    insert into public.devfit_records (email, data_type, record_key, occurred_on, data, updated_at)
    select lower(p_email), 'workout_session',
           left(coalesce(nullif(s.value->>'id', ''),
                coalesce(s.value->>'date', 'unknown') || '|' ||
                coalesce(s.value->>'workoutId', 'unknown') || '|' || s.ord::text), 180),
           case when coalesce(s.value->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                then (s.value->>'date')::date else null end,
           s.value, now()
    from jsonb_array_elements(p_data->'sessions') with ordinality s(value, ord)
    on conflict (email, data_type, record_key) do update
      set occurred_on = excluded.occurred_on,
          data = excluded.data,
          updated_at = excluded.updated_at;
  elsif p_data_type = 'progress' and jsonb_typeof(p_data->'programs') = 'array' then
    insert into public.devfit_records (email, data_type, record_key, occurred_on, data, updated_at)
    select lower(p_email), 'progress_week',
           left(coalesce(nullif(p.program->>'id', ''), 'legacy') || ':' || n.week_index::text, 180),
           case when coalesce(p.program->>'programStart', '') ~ '^\d{4}-\d{2}-\d{2}$'
                then (p.program->>'programStart')::date + (n.week_index * 7) else null end,
           jsonb_build_object(
             'programId', p.program->>'id',
             'weekIndex', n.week_index,
             'bw', coalesce(p.program->'bw'->n.week_index, '[]'::jsonb),
             'steps', coalesce(p.program->'steps'->n.week_index, '[]'::jsonb),
             'sleep', coalesce(p.program->'sleep'->n.week_index, '[]'::jsonb),
             'checkin', coalesce(p.program->'weeklyCheckin'->n.week_index, '{}'::jsonb)
           ), now()
    from jsonb_array_elements(p_data->'programs') p(program)
    cross join lateral generate_series(
      0,
      greatest(
        case when jsonb_typeof(p.program->'bw') = 'array' then jsonb_array_length(p.program->'bw') else 0 end,
        case when jsonb_typeof(p.program->'steps') = 'array' then jsonb_array_length(p.program->'steps') else 0 end,
        case when jsonb_typeof(p.program->'sleep') = 'array' then jsonb_array_length(p.program->'sleep') else 0 end,
        case when jsonb_typeof(p.program->'weeklyCheckin') = 'array' then jsonb_array_length(p.program->'weeklyCheckin') else 0 end
      ) - 1
    ) n(week_index)
    on conflict (email, data_type, record_key) do update
      set occurred_on = excluded.occurred_on,
          data = excluded.data,
          updated_at = excluded.updated_at;
  end if;
end;
$$;

revoke all on function public.sync_devfit_records(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_devfit_records(text, text, jsonb) to service_role;

create or replace function public.load_devfit_account(
  p_email text,
  p_data_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_approved boolean;
  v_rows jsonb;
begin
  if position('@' in v_email) < 2 or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_data_type is not null and p_data_type not in ('progress', 'nutrition', 'workouts', 'prefs') then
    return jsonb_build_object('status', 'invalid');
  end if;

  select approved into v_approved from public.devfit_subscribers where email = v_email;
  if not found or v_approved is not true then
    return jsonb_build_object('status', 'revoked');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'data_type', d.data_type, 'data', d.data, 'updated_at', d.updated_at
         ) order by d.data_type), '[]'::jsonb)
    into v_rows
  from public.devfit_data d
  where d.email = v_email
    and (p_data_type is null or d.data_type = p_data_type);

  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end;
$$;

revoke all on function public.load_devfit_account(text, text) from public, anon, authenticated;
grant execute on function public.load_devfit_account(text, text) to service_role;

create or replace function public.save_devfit_data_atomic(
  p_email text,
  p_data_type text,
  p_data jsonb,
  p_base_updated_at text,
  p_device_id text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_approved boolean;
  v_existing public.devfit_data%rowtype;
  v_now timestamptz := clock_timestamp();
  v_base timestamptz;
  v_allowed boolean;
  v_retry integer;
  v_hits integer;
  v_ip_allowed boolean;
  v_ip_retry integer;
  v_hash text;
begin
  if position('@' in v_email) < 2 or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_data_type not in ('progress', 'nutrition', 'workouts', 'prefs') or
     p_data is null or jsonb_typeof(p_data) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Defence in depth: the API has the same limits, but the database refuses an
  -- oversized document even if a future route forgets to validate it.
  if pg_column_size(p_data) > (case p_data_type
       when 'progress' then 524288 when 'nutrition' then 786432
       when 'workouts' then 1048576 else 65536 end) then
    return jsonb_build_object('status', 'too_large');
  end if;

  select approved into v_approved from public.devfit_subscribers where email = v_email;
  if not found or v_approved is not true then
    return jsonb_build_object('status', 'revoked');
  end if;

  select * into v_existing
  from public.devfit_data
  where email = v_email and data_type = p_data_type
  for update;

  if found then
    if v_existing.data = p_data then
      return jsonb_build_object('status', 'ok', 'unchanged', true, 'updated_at', v_existing.updated_at);
    end if;

    -- Account limits are the primary control. The IP limit is deliberately only
    -- an emergency ceiling so a gym, campus or carrier NAT cannot lock out users.
    select allowed, retry_after, current_hits into v_allowed, v_retry, v_hits
    from public.consume_devfit_rate_limit('data_user:' || encode(digest(v_email, 'sha256'), 'hex'), 1200, 3600);
    select allowed, retry_after into v_ip_allowed, v_ip_retry
    from public.consume_devfit_rate_limit('data_ip:' || left(coalesce(p_ip_hash, 'unknown'), 80), 30000, 3600);
    if not v_allowed or not v_ip_allowed then
      return jsonb_build_object('status', 'rate_limited', 'retryAfter', greatest(v_retry, v_ip_retry, 1));
    end if;

    begin
      v_base := nullif(trim(coalesce(p_base_updated_at, '')), '')::timestamptz;
    exception when others then
      v_base := null;
    end;
    if v_base is null or v_existing.updated_at <> v_base then
      return jsonb_build_object('status', 'conflict', 'row', jsonb_build_object(
        'data_type', v_existing.data_type, 'data', v_existing.data, 'updated_at', v_existing.updated_at
      ));
    end if;

    v_hash := encode(digest(convert_to(v_existing.data::text, 'UTF8'), 'sha256'), 'hex');
    perform public.archive_devfit_data_version(
      v_email, p_data_type, v_existing.data, v_hash,
      'server-before:' || left(coalesce(p_device_id, 'unknown'), 64)
    );
    update public.devfit_data
      set data = p_data, updated_at = v_now
      where email = v_email and data_type = p_data_type;
  else
    select allowed, retry_after, current_hits into v_allowed, v_retry, v_hits
    from public.consume_devfit_rate_limit('data_user:' || encode(digest(v_email, 'sha256'), 'hex'), 1200, 3600);
    select allowed, retry_after into v_ip_allowed, v_ip_retry
    from public.consume_devfit_rate_limit('data_ip:' || left(coalesce(p_ip_hash, 'unknown'), 80), 30000, 3600);
    if not v_allowed or not v_ip_allowed then
      return jsonb_build_object('status', 'rate_limited', 'retryAfter', greatest(v_retry, v_ip_retry, 1));
    end if;
    insert into public.devfit_data (email, data_type, data, updated_at)
    values (v_email, p_data_type, p_data, v_now)
    on conflict (email, data_type) do nothing;
    if not found then
      select * into v_existing from public.devfit_data
      where email = v_email and data_type = p_data_type;
      return jsonb_build_object('status', 'conflict', 'row', jsonb_build_object(
        'data_type', v_existing.data_type, 'data', v_existing.data, 'updated_at', v_existing.updated_at
      ));
    end if;
  end if;

  perform public.sync_devfit_records(v_email, p_data_type, p_data);
  return jsonb_build_object('status', 'ok', 'updated_at', v_now);
end;
$$;

revoke all on function public.save_devfit_data_atomic(text, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_devfit_data_atomic(text, text, jsonb, text, text, text)
  to service_role;

-- Backfill the row-oriented shadow store from every current document. No source
-- row is modified and the upserts are idempotent.
do $$
declare r record;
begin
  for r in select email, data_type, data from public.devfit_data loop
    perform public.sync_devfit_records(r.email, r.data_type, r.data);
  end loop;
end $$;

-- Browser roles have no direct table privileges. Explicit deny policies make
-- the intent visible to auditors and keep access closed if grants drift later.
do $$
declare t text;
begin
  foreach t in array array[
    'devfit_config', 'devfit_data', 'devfit_data_versions', 'devfit_errors',
    'devfit_logins', 'devfit_rate', 'devfit_records', 'devfit_subscribers'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists devfit_deny_browser_access on public.%I', t);
    execute format(
      'create policy devfit_deny_browser_access on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t
    );
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
