-- Normalize event tables by removing duplicated user attributes.
-- Keep user_id as the single source of user identity and join to auth.users / user_roles when querying.

alter table if exists public.event_generate
  drop column if exists username,
  drop column if exists role_snapshot;

alter table if exists public.event_stock_check
  drop column if exists username,
  drop column if exists role_snapshot;

alter table if exists public.event_catalog_save
  drop column if exists username,
  drop column if exists role_snapshot;

alter table if exists public.event_push
  drop column if exists username,
  drop column if exists role_snapshot;
