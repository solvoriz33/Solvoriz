create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('Bug', 'Feature Request', 'Confusing UI', 'General Feedback')),
  message text not null,
  screenshot_url text,
  page_path text,
  created_at timestamp with time zone not null default now()
);

alter table public.feedback enable row level security;

grant insert on public.feedback to anon, authenticated;
grant select, update, delete on public.feedback to authenticated;
grant usage, select on sequence public.feedback_id_seq to anon, authenticated;

drop policy if exists "feedback_insert_public" on public.feedback;
create policy "feedback_insert_public"
  on public.feedback for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "feedback_select_own_or_admin" on public.feedback;
create policy "feedback_select_own_or_admin"
  on public.feedback for select
  to authenticated
  using (user_id = auth.uid() or public.get_my_role() = 'admin');

drop policy if exists "feedback_admin_update" on public.feedback;
create policy "feedback_admin_update"
  on public.feedback for update
  to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "feedback_admin_delete" on public.feedback;
create policy "feedback_admin_delete"
  on public.feedback for delete
  to authenticated
  using (public.get_my_role() = 'admin');
