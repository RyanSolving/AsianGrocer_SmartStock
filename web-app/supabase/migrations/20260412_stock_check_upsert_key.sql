-- Keep only the newest row per user/date/mode before adding a unique key for upsert.
with ranked as (
  select
    uid_stock_check,
    row_number() over (
      partition by user_id, date, mode
      order by created_at desc, uid_stock_check desc
    ) as row_num
  from public.event_stock_check
)
delete from public.event_stock_check esc
using ranked
where esc.uid_stock_check = ranked.uid_stock_check
  and ranked.row_num > 1;

create unique index if not exists idx_event_stock_check_user_date_mode_unique
  on public.event_stock_check (user_id, date, mode);

drop policy if exists event_stock_check_update_policy on public.event_stock_check;
create policy event_stock_check_update_policy on public.event_stock_check
for update
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
