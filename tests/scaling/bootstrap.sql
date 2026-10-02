-- This bootstrap is for a NEW, DISPOSABLE local database only.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]
);
create table public.devfit_scale_environment (id boolean primary key default true check(id));
insert into public.devfit_scale_environment values(true);
