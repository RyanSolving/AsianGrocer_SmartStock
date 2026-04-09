-- Migration: Replace versioned catalog with a single catalog_items table
-- Date: 2026-04-09
-- PK: code (1 column) — globally unique per product

-- Step 1: Create new catalog_items table
create table if not exists public.catalog_items (
  code text primary key,
  location text not null,
  sub_location text not null,
  category text not null,
  product text not null,
  attribute text not null default '',
  official_name text not null,
  stocklist_name text not null,
  navigation_guide text not null,
  row_position text,
  updated_at timestamptz not null default now(),
  constraint catalog_items_row_position_check check (row_position in ('left', 'right', 'single') or row_position is null)
);

-- Step 2: Backfill empty codes with the old id as string
update public.catalog_entries
set code = id::text
where code is null or code = '';

-- Step 3: Fix duplicate codes globally (keep first, suffix rest with -1, -2, etc.)
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
  and ce.id = d.id;

-- Step 4: Migrate data from catalog_entries to catalog_items (take the active version)
-- Get the active version_id first
with active_version as (
  select id from public.catalog_versions where is_active = true limit 1
)
insert into public.catalog_items (code, location, sub_location, category, product, attribute, official_name, stocklist_name, navigation_guide, row_position)
select ce.code, ce.location, ce.sub_location, ce.category, ce.product, ce.attribute, ce.official_name, ce.stocklist_name, ce.navigation_guide, ce.row_position
from public.catalog_entries ce
inner join active_version av on ce.version_id = av.id
on conflict (code) do nothing;

-- Step 5: Drop old tables
drop table if exists public.catalog_entries cascade;
drop table if exists public.catalog_versions cascade;

-- Step 6: Add indexes for common queries
create index if not exists idx_catalog_items_category on public.catalog_items (category);
create index if not exists idx_catalog_items_location on public.catalog_items (location, sub_location);

-- Enable RLS
alter table public.catalog_items enable row level security;

drop policy if exists catalog_items_select_authenticated on public.catalog_items;
create policy catalog_items_select_authenticated on public.catalog_items
for select
using (auth.uid() is not null);

drop policy if exists catalog_items_insert_authenticated on public.catalog_items;
create policy catalog_items_insert_authenticated on public.catalog_items
for insert
with check (auth.uid() is not null);

drop policy if exists catalog_items_update_authenticated on public.catalog_items;
create policy catalog_items_update_authenticated on public.catalog_items
for update
using (auth.uid() is not null);

drop policy if exists catalog_items_delete_admin on public.catalog_items;
create policy catalog_items_delete_admin on public.catalog_items
for delete
using (public.has_role('admin'));
