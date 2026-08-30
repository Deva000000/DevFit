alter function public.delete_devfit_account(text)
  set search_path = public, pg_temp;

revoke all on function public.delete_devfit_account(text) from public, anon, authenticated;
grant execute on function public.delete_devfit_account(text) to service_role;
