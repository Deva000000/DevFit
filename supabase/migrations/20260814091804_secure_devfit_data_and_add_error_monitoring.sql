drop policy if exists devfit_anon_access on public.devfit_data;

create table if not exists public.devfit_errors (
  id bigint generated always as identity primary key,
  type text not null default 'error',
  message text not null default '',
  stack text,
  src text,
  page text,
  ua text,
  status integer,
  at timestamptz not null default now()
);

alter table public.devfit_errors enable row level security;

create index if not exists devfit_errors_at_idx on public.devfit_errors (at desc);
create index if not exists devfit_errors_type_at_idx on public.devfit_errors (type, at desc);

revoke all privileges on table public.devfit_config from anon, authenticated;
revoke all privileges on table public.devfit_data from anon, authenticated;
revoke all privileges on table public.devfit_data_versions from anon, authenticated;
revoke all privileges on table public.devfit_logins from anon, authenticated;
revoke all privileges on table public.devfit_rate from anon, authenticated;
revoke all privileges on table public.devfit_subscribers from anon, authenticated;
revoke all privileges on table public.devfit_errors from anon, authenticated;
