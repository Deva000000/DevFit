-- Reconstructed baseline for repeatable DevFit environments.
-- Production already had these tables before migration tracking was enabled.

create table if not exists public.devfit_subscribers (
  email text primary key,
  name text,
  tier text not null default 'free',
  approved boolean not null default true,
  expiry date,
  start_date date,
  plan text,
  updated_at timestamptz default now()
);

create table if not exists public.devfit_data (
  email text not null,
  data_type text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (email, data_type)
);

create table if not exists public.devfit_rate (
  id text primary key,
  hits integer not null default 0,
  reset_at bigint not null default 0
);

create table if not exists public.devfit_logins (
  email text not null,
  device_id text not null,
  user_agent text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  login_count integer not null default 1,
  primary key (email, device_id)
);

create table if not exists public.devfit_config (
  id integer primary key default 1,
  whatsapp text,
  price text,
  qr text,
  note text,
  updated_at timestamptz default now()
);

alter table public.devfit_subscribers enable row level security;
alter table public.devfit_data enable row level security;
alter table public.devfit_rate enable row level security;
alter table public.devfit_logins enable row level security;
alter table public.devfit_config enable row level security;

revoke all privileges on table public.devfit_subscribers from anon, authenticated;
revoke all privileges on table public.devfit_data from anon, authenticated;
revoke all privileges on table public.devfit_rate from anon, authenticated;
revoke all privileges on table public.devfit_logins from anon, authenticated;
revoke all privileges on table public.devfit_config from anon, authenticated;
