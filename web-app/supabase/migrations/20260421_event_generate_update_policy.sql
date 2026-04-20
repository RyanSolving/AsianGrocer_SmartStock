-- Add missing UPDATE policy for event_generate.
-- Without this, Supabase RLS silently blocks all UPDATE operations,
-- causing edit-saves to appear successful (HTTP 200) while updating 0 rows.
-- This is the root cause of items disappearing after editing a saved record.

drop policy if exists event_generate_update_policy on public.event_generate;
create policy event_generate_update_policy on public.event_generate
for update
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
