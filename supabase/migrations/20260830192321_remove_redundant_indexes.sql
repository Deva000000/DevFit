-- Both indexes duplicated active access paths while adding cost to every write.
drop index if exists public.devfit_errors_type_at_idx;
drop index if exists public.devfit_data_versions_lookup_idx;
