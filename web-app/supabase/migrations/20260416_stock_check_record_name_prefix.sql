update public.event_stock_check
set record_name = 'stock-check-' || to_char(date, 'YYYY-MM-DD')
where record_name is null
   or record_name like 'manual-entry-stock-%';
