-- This bootstrap is for a NEW, DISPOSABLE local database only.
-- Roles belong to the PostgreSQL cluster, not one database. A second isolated
-- test DB must not fail just because another test DB already created them.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end;$$;
create schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]
);
create table public.devfit_scale_environment (id boolean primary key default true check(id));
insert into public.devfit_scale_environment values(true);
