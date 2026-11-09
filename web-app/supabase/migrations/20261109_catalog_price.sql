-- Catalog price: the normal selling price of an item (see 20261110 for its unit and deals).
-- Stock In starts each row from this price; a price changed on a delivery is saved with the
-- delivery (with the price it replaced) and becomes the catalog price. Empty = not set yet.

alter table public.catalog_items
  add column if not exists price numeric(10, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_items_price_check'
      and conrelid = 'public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_price_check
      check (price is null or price >= 0);
  end if;
end $$;
