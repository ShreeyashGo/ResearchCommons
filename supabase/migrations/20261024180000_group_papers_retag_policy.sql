-- Tighten group_papers UPDATE to match DELETE: only the group owner or the
-- member who added the paper may retag it (previously any member could).
drop policy group_papers_update on public.group_papers;
create policy group_papers_update on public.group_papers for update to authenticated
  using (public.is_group_owner(group_id) or added_by = (select auth.uid()))
  with check (public.is_group_owner(group_id) or added_by = (select auth.uid()));
