create or replace function public.block_devfit_security_identity(
  p_scope text,
  p_key_hash text,
  p_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key_hash text := lower(trim(coalesce(p_key_hash, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_row public.devfit_security_blocks%rowtype;
begin
  if v_scope not in ('account', 'device', 'ip') then raise exception 'invalid block scope'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then raise exception 'invalid block reason'; end if;

  if v_scope = 'account' then
    if v_email = '' or char_length(v_email) > 254 or position('@' in v_email) <= 1 then
      raise exception 'invalid block account';
    end if;
    v_key_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');
  elsif v_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid block key';
  end if;

  insert into public.devfit_security_blocks
    (scope, key_hash, email, reason, active, expires_at, created_at, created_by, released_at)
  values
    (v_scope, v_key_hash, nullif(v_email, ''), v_reason, true, null, now(), 'owner', null)
  on conflict (scope, key_hash) do update set
    email = excluded.email,
    reason = excluded.reason,
    active = true,
    expires_at = null,
    created_at = now(),
    created_by = 'owner',
    released_at = null
  returning * into v_row;

  -- Revoke an account in the same transaction as its block. This also stops
  -- legacy signed sessions that predate device-bound tokens.
  if v_scope = 'account' then
    update public.devfit_subscribers
      set approved = false, tier = 'free', updated_at = now()
      where email = v_email;
  end if;

  insert into public.devfit_security_events
    (email, device_hash, ip_hash, event_type, severity, route, reason, blocked)
  values
    (nullif(v_email, ''), case when v_scope='device' then v_key_hash end,
     case when v_scope='ip' then v_key_hash end, v_scope || '_blocked', 'high',
     '/api/admin', v_reason, true);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.block_devfit_security_identity(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.block_devfit_security_identity(text,text,text,text)
  to service_role;
