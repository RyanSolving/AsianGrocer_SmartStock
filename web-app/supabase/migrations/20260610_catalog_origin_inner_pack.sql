alter table public.catalog_items
  add column if not exists origin text not null default '',
  add column if not exists inner_quantity numeric,
  add column if not exists inner_unit text not null default 'box';

update public.catalog_items
set
  origin = coalesce(origin, ''),
  inner_unit = coalesce(nullif(inner_unit, ''), 'box');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_items_inner_quantity_check'
      and conrelid = 'public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_inner_quantity_check
      check (inner_quantity is null or inner_quantity >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_items_inner_unit_check'
      and conrelid = 'public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_inner_unit_check
      check (inner_unit in ('box', 'bag', 'punnet', 'piece', 'tray', 'bunch', 'pack', 'kg', 'g'));
  end if;
end $$;
