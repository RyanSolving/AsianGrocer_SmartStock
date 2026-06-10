alter table public.catalog_items
  drop constraint if exists catalog_items_inner_unit_check;

alter table public.catalog_items
  add constraint catalog_items_inner_unit_check
  check (inner_unit in ('box', 'bag', 'punnet', 'piece', 'tray', 'bunch', 'pack', 'kg', 'g'));
