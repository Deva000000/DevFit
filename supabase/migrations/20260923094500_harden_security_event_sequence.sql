-- The initial security migration is already live. Explicitly remove sequence
-- access that older Supabase defaults granted to browser roles.
revoke all on sequence public.devfit_security_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.devfit_security_events_id_seq to service_role;
