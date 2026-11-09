-- Selling price: sold by Each / KG / Pack / Bunch / Punnet (price_unit), with `price` as the
-- normal "1 for $x" price and combo deals such as "2 for $9" in price_deals:
-- [{"qty": 2, "total": 9}, ...]. Existing prices become "Each".

alter table public.catalog_items
  add column if not exists price_unit text not null default 'ea',
  add column if not exists price_deals jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_items_price_unit_check' and conrelid = 'public.catalog_items'::regclass) then
    alter table public.catalog_items
      add constraint catalog_items_price_unit_check check (price_unit in ('ea', 'kg', 'pack', 'bunch', 'punnet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'catalog_items_price_deals_check' and conrelid = 'public.catalog_items'::regclass) then
    alter table public.catalog_items
      add constraint catalog_items_price_deals_check check (jsonb_typeof(price_deals) = 'array');
  end if;
end $$;
