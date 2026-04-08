alter table if exists public.catalog_entries
  add column if not exists code text;
