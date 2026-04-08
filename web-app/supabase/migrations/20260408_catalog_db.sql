create table if not exists public.catalog_versions (
  id uuid primary key default gen_random_uuid(),
  version_name text not null unique,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  item_count integer not null default 0,
  is_active boolean not null default false
);

create table if not exists public.catalog_entries (
  version_id uuid not null references public.catalog_versions (id) on delete cascade,
  id integer not null,
  code text,
  location text not null,
  sub_location text not null,
  category text not null,
  product text not null,
  attribute text not null,
  official_name text not null,
  stocklist_name text not null,
  navigation_guide text not null,
  row_position text,
  primary key (version_id, id),
  constraint catalog_entries_row_position_check check (row_position in ('left', 'right', 'single') or row_position is null)
);

alter table public.catalog_versions enable row level security;
alter table public.catalog_entries enable row level security;

drop policy if exists catalog_versions_select_authenticated on public.catalog_versions;
create policy catalog_versions_select_authenticated on public.catalog_versions
for select
using (auth.uid() is not null);

drop policy if exists catalog_versions_insert_authenticated on public.catalog_versions;
create policy catalog_versions_insert_authenticated on public.catalog_versions
for insert
with check (auth.uid() is not null);

drop policy if exists catalog_versions_update_admin on public.catalog_versions;
create policy catalog_versions_update_admin on public.catalog_versions
for update
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists catalog_entries_select_authenticated on public.catalog_entries;
create policy catalog_entries_select_authenticated on public.catalog_entries
for select
using (auth.uid() is not null);

drop policy if exists catalog_entries_insert_authenticated on public.catalog_entries;
create policy catalog_entries_insert_authenticated on public.catalog_entries
for insert
with check (auth.uid() is not null);

create index if not exists idx_catalog_versions_uploaded_at on public.catalog_versions (uploaded_at desc);
create index if not exists idx_catalog_entries_version on public.catalog_entries (version_id);
