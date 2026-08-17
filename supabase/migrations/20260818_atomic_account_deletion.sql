create or replace function public.delete_devfit_account(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_subscribers integer;
  v_current_data integer;
  v_versions integer;
  v_devices integer;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid email';
  end if;

  select count(*) into v_subscribers from public.devfit_subscribers where email = v_email;
  select count(*) into v_current_data from public.devfit_data where email = v_email;
  select count(*) into v_versions from public.devfit_data_versions where email = v_email;
  select count(*) into v_devices from public.devfit_logins where email = v_email;

  delete from public.devfit_data_versions where email = v_email;
  delete from public.devfit_data where email = v_email;
  delete from public.devfit_logins where email = v_email;
  delete from public.devfit_subscribers where email = v_email;

  return jsonb_build_object(
    'email', v_email,
    'subscribers', v_subscribers,
    'currentData', v_current_data,
    'recoveryVersions', v_versions,
    'devices', v_devices
  );
end;
$$;

revoke all on function public.delete_devfit_account(text) from public, anon, authenticated;
grant execute on function public.delete_devfit_account(text) to service_role;

comment on function public.delete_devfit_account(text) is
  'Atomically deletes one verified DevFit account and its account-bound data. Service role only.';
