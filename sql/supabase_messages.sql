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

-- Indexes for fast lookups
create index if not exists idx_conversations_recruiter_student on conversations (recruiter_id, student_id);
create index if not exists idx_messages_conversation_created on messages (conversation_id, created_at desc);

-- RLS policies (example; review in Supabase UI before enabling)
-- Allow participants to SELECT/INSERT messages for conversations they are part of
-- You'll need to enable RLS and adapt policies to your auth setup.
