-- Create conversation and messages tables for in-app chat
-- Run this in Supabase SQL editor to apply

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references users(id) on delete cascade,
  student_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(recruiter_id, student_id, project_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create table if not exists creator_conversations (
  id uuid primary key default gen_random_uuid(),
  creator_one_id uuid not null references users(id) on delete cascade,
  creator_two_id uuid not null references users(id) on delete cascade,
  initiator_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
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
create index if not exists idx_conversations_recruiter_student_project on conversations (recruiter_id, student_id, project_id);
create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at desc);
create index if not exists idx_creator_conversations_pair on creator_conversations (creator_one_id, creator_two_id);
create index if not exists idx_creator_messages_conversation_created on creator_messages (creator_conversation_id, created_at desc);

-- RLS policies (example; review in Supabase UI before enabling)
-- Conversations and messages are always project-scoped.
-- Only participants or admins may read a conversation or its messages.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
CREATE POLICY "conversations_select_participant"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    recruiter_id = auth.uid()
    OR student_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "conversations_insert_participant" ON public.conversations;
CREATE POLICY "conversations_insert_participant"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    recruiter_id <> student_id
    AND (recruiter_id = auth.uid() OR student_id = auth.uid())
    AND project_id IS NOT NULL
  );

DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;
CREATE POLICY "messages_select_participant"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;
CREATE POLICY "messages_insert_participant"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "creator_conversations_select_participant" ON public.creator_conversations;
CREATE POLICY "creator_conversations_select_participant"
  ON public.creator_conversations FOR SELECT
  TO authenticated
  USING (
    creator_one_id = auth.uid()
    OR creator_two_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "creator_conversations_insert_creator" ON public.creator_conversations;
CREATE POLICY "creator_conversations_insert_creator"
  ON public.creator_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    initiator_id = auth.uid()
    AND (creator_one_id = auth.uid() OR creator_two_id = auth.uid())
    AND creator_one_id <> creator_two_id
    AND project_id IS NOT NULL
  );

DROP POLICY IF EXISTS "creator_messages_select_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_select_participant"
  ON public.creator_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "creator_messages_insert_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_insert_participant"
  ON public.creator_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "creator_messages_update_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_update_participant"
  ON public.creator_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
    )
  );

-- To support strict project-thread messaging, all conversation records must include a project_id.
