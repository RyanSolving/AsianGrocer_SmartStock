-- Selling price sold by the Pack also has a weight (pack of 250g, 500g, 1kg ...), in grams.
-- Empty when the unit is not a pack or the weight was not chosen.

alter table public.catalog_items
  add column if not exists price_pack_g integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_items_price_pack_g_check' and conrelid = 'public.catalog_items'::regclass) then
    alter table public.catalog_items
      add constraint catalog_items_price_pack_g_check check (price_pack_g is null or (price_pack_g > 0 and price_pack_g <= 99999));
  end if;
end $$;
