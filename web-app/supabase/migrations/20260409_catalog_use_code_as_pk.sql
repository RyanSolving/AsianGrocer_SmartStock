-- Migration: Use `code` as the sole primary key for catalog_entries (legacy schema only)
-- Date: 2026-04-09
-- Note: This migration is intentionally guarded. If the app already migrated to catalog_items,
-- this becomes a no-op so migration history remains replay-safe.

do $$
begin
  if to_regclass('public.catalog_entries') is null then
    raise notice 'catalog_entries not found; skipping legacy PK migration.';
    return;
  end if;

  -- Backfill empty codes with id
  execute $sql$
    update public.catalog_entries
    set code = id::text
    where code is null or code = ''
  $sql$;

  -- Deduplicate codes globally
  execute $sql$
    with duplicates as (
      select code, id,
        row_number() over (partition by code order by id) as rn,
        count(*) over (partition by code) as cnt
      from public.catalog_entries
    )
    update public.catalog_entries ce
    set code = ce.code || '-' || (d.rn - 1)::text
    from duplicates d
    where d.cnt > 1
      and d.rn > 1
      and ce.id = d.id
  $sql$;

  execute 'alter table public.catalog_entries alter column code set not null';

  execute 'alter table public.catalog_entries drop constraint if exists catalog_entries_pkey';

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.catalog_entries'::regclass
      and contype = 'p'
  ) then
    execute 'alter table public.catalog_entries add primary key (code)';
  end if;

  execute 'create index if not exists idx_catalog_entries_version on public.catalog_entries (version_id)';
end $$;
