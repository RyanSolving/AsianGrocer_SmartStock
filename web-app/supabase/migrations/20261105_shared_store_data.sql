-- Shared store data: every account with the `admin` or `staff` role sees and edits the
-- whole store's Stock In, Stock Close, push and report-flag records, not only its own.
-- Accounts without a role keep the old behaviour (their own rows only), so an account
-- created through an open sign-up cannot read the store's data.
--
-- Backward compatible with the app version deployed before this change: the old unique
-- keys (user_id, date, mode) and (user_id, report_date, item_code) stay, and the new
-- shared keys (date, mode) and (report_date, item_code) are added beside them.

create or replace function public.is_store_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role in ('admin', 'staff')
  );
$$;

revoke all on function public.is_store_member() from public;
grant execute on function public.is_store_member() to authenticated;

-- event_generate (Stock In records)
drop policy if exists event_generate_all_policy on public.event_generate;
create policy event_generate_select on public.event_generate for select to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_generate_insert on public.event_generate for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy event_generate_update on public.event_generate for update to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()))
  with check ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_generate_delete on public.event_generate for delete to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));

-- event_push (warehouse push markers)
drop policy if exists event_push_all_policy on public.event_push;
create policy event_push_select on public.event_push for select to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_push_insert on public.event_push for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy event_push_update on public.event_push for update to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()))
  with check ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_push_delete on public.event_push for delete to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));

-- event_stock_check (Stock Close records): one close per date for the whole store.
drop policy if exists event_stock_check_all_policy on public.event_stock_check;
create policy event_stock_check_select on public.event_stock_check for select to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_stock_check_insert on public.event_stock_check for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy event_stock_check_update on public.event_stock_check for update to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()))
  with check ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy event_stock_check_delete on public.event_stock_check for delete to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));

create unique index if not exists idx_event_stock_check_date_mode_unique
  on public.event_stock_check (date, mode);

-- report_flag_override (Daily Report badge overrides): one per item per date.
drop policy if exists report_flag_override_all_policy on public.report_flag_override;
create policy report_flag_override_select on public.report_flag_override for select to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy report_flag_override_insert on public.report_flag_override for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy report_flag_override_update on public.report_flag_override for update to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()))
  with check ((select public.is_store_member()) or user_id = (select auth.uid()));
create policy report_flag_override_delete on public.report_flag_override for delete to authenticated
  using ((select public.is_store_member()) or user_id = (select auth.uid()));

create unique index if not exists idx_report_flag_override_date_code_unique
  on public.report_flag_override (report_date, item_code);
