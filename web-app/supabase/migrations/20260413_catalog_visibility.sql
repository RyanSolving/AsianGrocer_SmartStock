alter table public.catalog_items
  add column if not exists is_visible boolean not null default true;

update public.catalog_items
set is_visible = true
where is_visible is null;
