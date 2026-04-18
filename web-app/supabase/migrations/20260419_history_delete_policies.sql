drop policy if exists event_generate_delete_policy on public.event_generate;
create policy event_generate_delete_policy on public.event_generate
for delete
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists event_stock_check_delete_policy on public.event_stock_check;
create policy event_stock_check_delete_policy on public.event_stock_check
for delete
using (user_id = auth.uid() or public.has_role('admin'));
