-- =============================================================================
-- Report flag overrides
-- =============================================================================
-- Staff can change an item's stock flag on the Daily Report (choose another flag,
-- or remove it). One row per user, report date and item; no row = automatic flag.
-- A row with flag = null means "no badge".
--
-- Idempotent: safe to run more than once.
-- =============================================================================

create table if not exists public.report_flag_override (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  report_date date        not null,
  item_code   text        not null,
  flag        text        null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, report_date, item_code),
  constraint report_flag_override_flag_check
    check (flag is null or flag in ('Stock-out', 'Low stock', 'Over-stock', 'No sell today')),
  constraint report_flag_override_item_code_check
    check (length(btrim(item_code)) > 0)
);

comment on table public.report_flag_override is
  'Manual stock flags on the Daily Report. No row = automatic flag; flag null = no badge.';

alter table public.report_flag_override enable row level security;

-- The primary key (user_id, report_date, item_code) already serves the per-user, per-date lookup.
drop policy if exists report_flag_override_all_policy on public.report_flag_override;
create policy report_flag_override_all_policy on public.report_flag_override
for all
to authenticated
using      ((select auth.uid()) = user_id or (select public.has_role('admin')))
with check ((select auth.uid()) = user_id or (select public.has_role('admin')));

grant select, insert, update, delete on public.report_flag_override to authenticated;
revoke all on public.report_flag_override from anon;
