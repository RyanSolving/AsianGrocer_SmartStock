-- Migration: Grant authenticated access to catalog_items
-- Date: 2026-04-09
-- Purpose: Ensure the single-table catalog schema is readable and writable after RLS is enabled.

do $$
begin
	if to_regclass('public.catalog_items') is null then
		raise notice 'public.catalog_items does not exist; skipping catalog permission grants.';
		return;
	end if;

	execute 'alter table public.catalog_items enable row level security';
	execute 'grant select, insert, update, delete on public.catalog_items to authenticated';
end $$;
