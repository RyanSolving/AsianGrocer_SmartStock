-- =============================================================================
-- Consolidate RLS Policies — Best Practice Fix
-- =============================================================================
-- Problem: Policies were defined one operation at a time (SELECT, INSERT, DELETE)
-- which made it easy to forget UPDATE. Missing UPDATE = silent 0-row updates.
--
-- Fix: Replace all fragmented policies with a single FOR ALL policy per table.
-- FOR ALL covers SELECT + INSERT + UPDATE + DELETE in one place — impossible to
-- forget a single operation.
--
-- This migration is idempotent. Safe to run on any existing database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- event_generate — was missing UPDATE (root cause of "disappearing items" bug)
-- -----------------------------------------------------------------------------
drop policy if exists event_generate_select_policy        on public.event_generate;
drop policy if exists event_generate_insert_policy        on public.event_generate;
drop policy if exists event_generate_update_policy        on public.event_generate;
drop policy if exists event_generate_delete_policy        on public.event_generate;

create policy event_generate_all_policy on public.event_generate
for all
using  (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- event_stock_check — had UPDATE from 20260412, but consolidate for consistency
-- -----------------------------------------------------------------------------
drop policy if exists event_stock_check_select_policy     on public.event_stock_check;
drop policy if exists event_stock_check_insert_policy     on public.event_stock_check;
drop policy if exists event_stock_check_update_policy     on public.event_stock_check;
drop policy if exists event_stock_check_delete_policy     on public.event_stock_check;

create policy event_stock_check_all_policy on public.event_stock_check
for all
using  (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- event_catalog_save — was missing UPDATE + DELETE
-- -----------------------------------------------------------------------------
drop policy if exists event_catalog_save_select_policy    on public.event_catalog_save;
drop policy if exists event_catalog_save_insert_policy    on public.event_catalog_save;
drop policy if exists event_catalog_save_update_policy    on public.event_catalog_save;
drop policy if exists event_catalog_save_delete_policy    on public.event_catalog_save;

create policy event_catalog_save_all_policy on public.event_catalog_save
for all
using  (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- event_push — was missing UPDATE + DELETE
-- -----------------------------------------------------------------------------
drop policy if exists event_push_select_policy            on public.event_push;
drop policy if exists event_push_insert_policy            on public.event_push;
drop policy if exists event_push_update_policy            on public.event_push;
drop policy if exists event_push_delete_policy            on public.event_push;

create policy event_push_all_policy on public.event_push
for all
using  (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- user_roles — was missing UPDATE + DELETE
-- -----------------------------------------------------------------------------
drop policy if exists user_roles_read_policy              on public.user_roles;
drop policy if exists user_roles_update_policy            on public.user_roles;
drop policy if exists user_roles_delete_policy            on public.user_roles;

create policy user_roles_all_policy on public.user_roles
for all
using  (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
