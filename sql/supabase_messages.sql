-- Create conversation and messages tables for in-app chat
-- Run this in Supabase SQL editor to apply

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references users(id) on delete cascade,
  student_id uuid references users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now(),
  read boolean default false
);

create table if not exists creator_conversations (
  id uuid primary key default gen_random_uuid(),
  creator_one_id uuid not null references users(id) on delete cascade,
  creator_two_id uuid not null references users(id) on delete cascade,
  initiator_id uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now(),
  check (creator_one_id <> creator_two_id),
  unique (creator_one_id, creator_two_id, project_id)
);

create table if not exists creator_messages (
  id uuid primary key default gen_random_uuid(),
  creator_conversation_id uuid not null references creator_conversations(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now(),
  read boolean default false
);

-- Indexes for fast lookups
create index if not exists idx_conversations_recruiter_student on conversations (recruiter_id, student_id);
create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at desc);
create index if not exists idx_creator_conversations_pair on creator_conversations (creator_one_id, creator_two_id);
create index if not exists idx_creator_messages_conversation_created on creator_messages (creator_conversation_id, created_at desc);

alter table conversations enable row level security;
alter table messages enable row level security;
alter table creator_conversations enable row level security;
alter table creator_messages enable row level security;

drop policy if exists "conversations_select_participant" on conversations;
create policy "conversations_select_participant"
  on conversations for select
  to authenticated
  using (recruiter_id = auth.uid() or student_id = auth.uid());

drop policy if exists "conversations_insert_recruiter_or_student" on conversations;
create policy "conversations_insert_recruiter_or_student"
  on conversations for insert
  to authenticated
  with check (
    recruiter_id <> student_id
    and (
      recruiter_id = auth.uid()
      or student_id = auth.uid()
    )
  );

drop policy if exists "messages_select_participant" on messages;
create policy "messages_select_participant"
  on messages for select
  to authenticated
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.recruiter_id = auth.uid() or c.student_id = auth.uid())
    )
  );

drop policy if exists "messages_insert_sender_participant" on messages;
create policy "messages_insert_sender_participant"
  on messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.recruiter_id = auth.uid() or c.student_id = auth.uid())
        and c.recruiter_id <> c.student_id
    )
  );

drop policy if exists "creator_conversations_select_participant" on creator_conversations;
create policy "creator_conversations_select_participant"
  on creator_conversations for select
  to authenticated
  using (creator_one_id = auth.uid() or creator_two_id = auth.uid());

drop policy if exists "creator_conversations_insert_creator" on creator_conversations;
create policy "creator_conversations_insert_creator"
  on creator_conversations for insert
  to authenticated
  with check (
    initiator_id = auth.uid()
    and (creator_one_id = auth.uid() or creator_two_id = auth.uid())
    and creator_one_id <> creator_two_id
  );

drop policy if exists "creator_messages_select_participant" on creator_messages;
create policy "creator_messages_select_participant"
  on creator_messages for select
  to authenticated
  using (
    exists (
      select 1 from creator_conversations c
      where c.id = creator_conversation_id
        and (c.creator_one_id = auth.uid() or c.creator_two_id = auth.uid())
    )
  );

drop policy if exists "creator_messages_insert_participant" on creator_messages;
create policy "creator_messages_insert_participant"
  on creator_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from creator_conversations c
      where c.id = creator_conversation_id
        and (c.creator_one_id = auth.uid() or c.creator_two_id = auth.uid())
        and c.creator_one_id <> c.creator_two_id
    )
  );

drop policy if exists "creator_messages_update_participant" on creator_messages;
create policy "creator_messages_update_participant"
  on creator_messages for update
  to authenticated
  using (
    exists (
      select 1 from creator_conversations c
      where c.id = creator_conversation_id
        and (c.creator_one_id = auth.uid() or c.creator_two_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from creator_conversations c
      where c.id = creator_conversation_id
        and (c.creator_one_id = auth.uid() or c.creator_two_id = auth.uid())
    )
  );
