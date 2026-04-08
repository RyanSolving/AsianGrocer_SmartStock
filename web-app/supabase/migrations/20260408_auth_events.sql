create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role),
  constraint user_roles_role_check check (role in ('admin', 'staff', 'viewer'))
);

create or replace function public.has_role(requested_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = requested_role
  );
$$;

create table if not exists public.event_generate (
  uid_generate uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  input_file_name text not null,
  catalog_version text not null,
  output_from_model jsonb not null,
  log_time timestamptz not null default now(),
  edited boolean not null default false,
  final_output jsonb not null,
  stock_mode text not null,
  constraint event_generate_stock_mode_check check (stock_mode in ('closing_check', 'arrival_entry'))
);

create table if not exists public.event_stock_check (
  uid_stock_check uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  mode text not null,
  item_data jsonb not null,
  created_at timestamptz not null default now(),
  constraint event_stock_check_mode_check check (mode in ('closing_check', 'arrival_entry'))
);

create table if not exists public.event_catalog_save (
  uid_catalog uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  csv_data text not null,
  catalog_version text,
  datetime timestamptz not null default now()
);

create table if not exists public.event_push (
  uid_push uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  uid_generate uuid references public.event_generate (uid_generate) on delete set null,
  datetime timestamptz not null default now()
);

alter table public.user_roles enable row level security;
alter table public.event_generate enable row level security;
alter table public.event_stock_check enable row level security;
alter table public.event_catalog_save enable row level security;
alter table public.event_push enable row level security;

drop policy if exists user_roles_read_policy on public.user_roles;
create policy user_roles_read_policy on public.user_roles
for select
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_generate_select_policy on public.event_generate;
create policy event_generate_select_policy on public.event_generate
for select
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_generate_insert_policy on public.event_generate;
create policy event_generate_insert_policy on public.event_generate
for insert
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_stock_check_select_policy on public.event_stock_check;
create policy event_stock_check_select_policy on public.event_stock_check
for select
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_stock_check_insert_policy on public.event_stock_check;
create policy event_stock_check_insert_policy on public.event_stock_check
for insert
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_catalog_save_select_policy on public.event_catalog_save;
create policy event_catalog_save_select_policy on public.event_catalog_save
for select
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_catalog_save_insert_policy on public.event_catalog_save;
create policy event_catalog_save_insert_policy on public.event_catalog_save
for insert
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_push_select_policy on public.event_push;
create policy event_push_select_policy on public.event_push
for select
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_push_insert_policy on public.event_push;
create policy event_push_insert_policy on public.event_push
for insert
with check (user_id = auth.uid() or public.has_role('admin'));

create index if not exists idx_event_generate_user_time on public.event_generate (user_id, log_time desc);
create index if not exists idx_event_stock_check_user_time on public.event_stock_check (user_id, created_at desc);
create index if not exists idx_event_catalog_save_user_time on public.event_catalog_save (user_id, datetime desc);
create index if not exists idx_event_push_user_time on public.event_push (user_id, datetime desc);
