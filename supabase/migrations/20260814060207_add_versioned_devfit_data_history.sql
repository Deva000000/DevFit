create table if not exists public.devfit_data_versions (
  id bigint generated always as identity primary key,
  email text not null,
  data_type text not null,
  data jsonb not null,
  content_hash text not null,
  source_device text,
  created_at timestamptz not null default now(),
  constraint devfit_data_versions_email_type_hash_key unique (email, data_type, content_hash)
);

alter table public.devfit_data_versions enable row level security;

create index if not exists devfit_data_versions_lookup_idx
  on public.devfit_data_versions (email, data_type, created_at desc);

insert into public.devfit_data_versions
  (email, data_type, data, content_hash, source_device, created_at)
select email, data_type, data, 'legacy-' || md5(data::text),
       'migration-before-account-backup', coalesce(updated_at, now())
from public.devfit_data
on conflict (email, data_type, content_hash) do nothing;
