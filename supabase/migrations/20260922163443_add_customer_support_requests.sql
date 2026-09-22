create table if not exists public.devfit_support_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  whatsapp text not null check (whatsapp ~ '^\+?[0-9]{7,15}$'),
  category text not null check (category in ('feedback', 'app_issue', 'account_login', 'payment', 'training_plan')),
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_message_id text,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists devfit_support_requests_email_created_idx
  on public.devfit_support_requests (email, created_at desc);
create index if not exists devfit_support_requests_status_created_idx
  on public.devfit_support_requests (status, created_at desc);
create index if not exists devfit_support_requests_email_status_created_idx
  on public.devfit_support_requests (email_status, created_at desc);

alter table public.devfit_support_requests enable row level security;
revoke all on table public.devfit_support_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.devfit_support_requests to service_role;

-- Browser roles intentionally receive no policy or grant. DevFit's custom
-- signed session is verified by the server, which uses the service role.

create or replace function public.delete_devfit_account(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_subscribers integer;
  v_current_data integer;
  v_versions integer;
  v_devices integer;
  v_records integer;
  v_payments integer;
  v_support integer;
begin
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'invalid email'; end if;

  select count(*) into v_subscribers from public.devfit_subscribers where email = v_email;
  select count(*) into v_current_data from public.devfit_data where email = v_email;
  select count(*) into v_versions from public.devfit_data_versions where email = v_email;
  select count(*) into v_devices from public.devfit_logins where email = v_email;
  select count(*) into v_records from public.devfit_records where email = v_email;
  select count(*) into v_payments from public.devfit_payments where email = v_email;
  select count(*) into v_support from public.devfit_support_requests where email = v_email;

  delete from public.devfit_support_requests where email = v_email;
  delete from public.devfit_payments where email = v_email;
  delete from public.devfit_records where email = v_email;
  delete from public.devfit_data_versions where email = v_email;
  delete from public.devfit_data where email = v_email;
  delete from public.devfit_logins where email = v_email;
  delete from public.devfit_subscribers where email = v_email;

  return jsonb_build_object(
    'email', v_email, 'subscribers', v_subscribers, 'currentData', v_current_data,
    'recoveryVersions', v_versions, 'devices', v_devices, 'records', v_records,
    'payments', v_payments, 'supportRequests', v_support
  );
end;
$$;

revoke all on function public.delete_devfit_account(text) from public, anon, authenticated;
grant execute on function public.delete_devfit_account(text) to service_role;

comment on table public.devfit_support_requests is
  'Private customer-support requests, accessible only through verified DevFit server operations.';
