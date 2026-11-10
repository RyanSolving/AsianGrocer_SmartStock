-- Fruit and Vegies are counted and received separately (BUSINESS_RULES.md, "Fruit and Vegies").
-- Each Stock Close and Stock In record belongs to one section. Existing rows are fruit.
--
-- APPLY THIS BEFORE DEPLOYING the app version that saves a section: the app upserts Stock Close
-- on (date, mode, section), which needs the unique index created below.

alter table public.event_stock_check
  add column if not exists section text not null default 'fruit';
alter table public.event_generate
  add column if not exists section text not null default 'fruit';

alter table public.event_stock_check drop constraint if exists event_stock_check_section_check;
alter table public.event_stock_check
  add constraint event_stock_check_section_check check (section in ('fruit', 'vegies'));
alter table public.event_generate drop constraint if exists event_generate_section_check;
alter table public.event_generate
  add constraint event_generate_section_check check (section in ('fruit', 'vegies'));

-- One close per date per section for the whole store. The old keys allowed one per date,
-- which would make a vegies close replace the fruit close.
drop index if exists public.idx_event_stock_check_user_date_mode_unique;
drop index if exists public.idx_event_stock_check_date_mode_unique;
create unique index if not exists idx_event_stock_check_date_mode_section_unique
  on public.event_stock_check (date, mode, section);

create index if not exists idx_event_generate_section_mode
  on public.event_generate (section, stock_mode);
