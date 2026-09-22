create table if not exists public.devfit_payments (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  reference text not null check (length(reference) between 8 and 80),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 450000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  unique (email, content_hash)
);

create index if not exists devfit_payments_email_uploaded_idx
  on public.devfit_payments (email, uploaded_at desc);
create index if not exists devfit_payments_status_uploaded_idx
  on public.devfit_payments (status, uploaded_at desc);

alter table public.devfit_payments enable row level security;
revoke all on table public.devfit_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.devfit_payments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'devfit-payment-proofs', 'devfit-payment-proofs', false, 450000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Service-role API access only. No storage.objects policies are created, so
-- browser anon/authenticated roles cannot list, upload, replace or read proofs.

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
begin
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'invalid email'; end if;

  select count(*) into v_subscribers from public.devfit_subscribers where email = v_email;
  select count(*) into v_current_data from public.devfit_data where email = v_email;
  select count(*) into v_versions from public.devfit_data_versions where email = v_email;
  select count(*) into v_devices from public.devfit_logins where email = v_email;
  select count(*) into v_records from public.devfit_records where email = v_email;
  select count(*) into v_payments from public.devfit_payments where email = v_email;

  delete from public.devfit_payments where email = v_email;
  delete from public.devfit_records where email = v_email;
  delete from public.devfit_data_versions where email = v_email;
  delete from public.devfit_data where email = v_email;
  delete from public.devfit_logins where email = v_email;
  delete from public.devfit_subscribers where email = v_email;

  return jsonb_build_object(
    'email', v_email, 'subscribers', v_subscribers, 'currentData', v_current_data,
    'recoveryVersions', v_versions, 'devices', v_devices, 'records', v_records,
    'payments', v_payments
  );
end;
$$;

revoke all on function public.delete_devfit_account(text) from public, anon, authenticated;
grant execute on function public.delete_devfit_account(text) to service_role;

comment on table public.devfit_payments is
  'Private receipt metadata. Proof images live in the private devfit-payment-proofs Storage bucket.';
