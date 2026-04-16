alter table public.event_generate
  add column if not exists record_name text;

alter table public.event_stock_check
  add column if not exists record_name text;

update public.event_generate
set record_name = 'manual-entry-stock-' || to_char((final_output->>'stock_date')::date, 'YYYY-MM-DD')
where record_name is null
  and final_output ? 'stock_date'
  and (final_output->>'stock_date')::date is not null;

update public.event_stock_check
set record_name = 'manual-entry-stock-' || to_char(date, 'YYYY-MM-DD')
where record_name is null;
