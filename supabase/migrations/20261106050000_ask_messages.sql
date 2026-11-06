-- Persisted Ask AI threads: one row per question/answer exchange, private to its author.
create table public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  paper_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 1000),
  answer jsonb not null,
  meta jsonb not null,
  annotation_id uuid references public.annotations (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (group_id, paper_id) references public.group_papers (group_id, paper_id) on delete cascade
);
create index ask_messages_thread_idx
  on public.ask_messages (user_id, group_id, paper_id, created_at desc);

alter table public.ask_messages enable row level security;

create policy ask_messages_select on public.ask_messages for select to authenticated
  using (user_id = (select auth.uid()) and public.is_group_member(group_id));
create policy ask_messages_insert on public.ask_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
create policy ask_messages_delete on public.ask_messages for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_group_member(group_id));

revoke all on public.ask_messages from anon, authenticated;
grant select, insert, delete on public.ask_messages to authenticated;
