-- =============================================================================
-- Enable Supabase Realtime for Stock In / Stock Close history tables
-- =============================================================================
-- The UI subscribes to postgres_changes on these tables so history lists update
-- without a manual refresh. RLS still applies: users only receive their own rows
-- (admins receive all).
--
-- REPLICA IDENTITY FULL makes DELETE/UPDATE events carry the full old row
-- (including user_id), which the per-user realtime filter needs.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

alter table public.event_generate    replica identity full;
alter table public.event_push        replica identity full;
alter table public.event_stock_check replica identity full;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['event_generate', 'event_push', 'event_stock_check']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end
$$;
