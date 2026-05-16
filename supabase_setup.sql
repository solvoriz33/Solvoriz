-- ============================================================
-- SOLVORIZ — SUPABASE DATABASE SETUP
-- Run this entire file in the Supabase SQL Editor
-- Go to: https://app.supabase.com → your project → SQL Editor → New query
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. USERS TABLE
--    Mirrors auth.users — stores role and display info
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name          TEXT,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'student'
                     CHECK (role IN ('student', 'recruiter', 'admin')),
  verified_recruiter BOOLEAN NOT NULL DEFAULT false,
  accepted_recruiter_conduct BOOLEAN NOT NULL DEFAULT false,
  suspended_until    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS verified_recruiter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_recruiter_conduct BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_verified_recruiter ON public.users(verified_recruiter);
CREATE INDEX IF NOT EXISTS idx_users_suspended_until ON public.users(suspended_until);


-- ────────────────────────────────────────────────────────────
-- 2. STUDENT PROFILES TABLE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  handle         TEXT UNIQUE,
  age            INT,
  avatar_url     TEXT,
  github_username TEXT,
  headline       TEXT,
  bio            TEXT,
  location       TEXT,
  visibility     TEXT NOT NULL DEFAULT 'public'
                   CHECK (visibility IN ('public', 'hidden')),
  availability   TEXT DEFAULT 'not set'
                   CHECK (availability IN ('available', 'open', 'busy', 'not set', '')),
  skills         TEXT[] DEFAULT '{}',
  discoverable   BOOLEAN NOT NULL DEFAULT false,
  featured       BOOLEAN NOT NULL DEFAULT false,
  review_status  TEXT NOT NULL DEFAULT 'pending'
                   CHECK (review_status IN ('pending', 'approved', 'flagged')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS handle TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS age INT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS github_username TEXT,
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'not set',
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON public.student_profiles(user_id);
-- GIN index for fast skills array search
CREATE INDEX IF NOT EXISTS idx_student_profiles_skills ON public.student_profiles USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_student_profiles_featured ON public.student_profiles(featured);


-- ────────────────────────────────────────────────────────────
-- 3. PROJECTS TABLE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  tech_stack    TEXT[] DEFAULT '{}',
  project_type  TEXT DEFAULT 'Side Project',
  image_url     TEXT,
  visible       BOOLEAN NOT NULL DEFAULT true,
  featured      BOOLEAN NOT NULL DEFAULT false,
  review_status TEXT NOT NULL DEFAULT 'active'
                   CHECK (review_status IN ('active', 'under review', 'flagged')),
  demo_link     TEXT,
  github_link   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tech_stack TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'Side Project',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS demo_link TEXT,
  ADD COLUMN IF NOT EXISTS github_link TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_tech_stack ON public.projects USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON public.projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_visible ON public.projects(visible);

CREATE TABLE IF NOT EXISTS public.contact_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  payload     JSONB DEFAULT '{}'::jsonb,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (recruiter_id, student_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_recruiter_student ON public.conversations(recruiter_id, student_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.creator_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_one_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_two_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  initiator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (creator_one_id <> creator_two_id AND creator_one_id::text < creator_two_id::text),
  UNIQUE (creator_one_id, creator_two_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.creator_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_conversation_id uuid NOT NULL REFERENCES public.creator_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_conversations_pair ON public.creator_conversations(creator_one_id, creator_two_id);
CREATE INDEX IF NOT EXISTS idx_creator_messages_conversation_created ON public.creator_messages(creator_conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.moderation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  reported_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  reason_category text NOT NULL CHECK (reason_category IN ('Harassment', 'Spam', 'Contact sharing', 'Inappropriate request', 'Suspicious grooming', 'False identity', 'Other')),
  reason_detail text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter ON public.moderation_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported ON public.moderation_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON public.moderation_reports(status);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('report_reviewed', 'user_blocked', 'user_unblocked', 'user_suspended', 'user_unsuspended', 'recruiter_verified', 'content_removed', 'conversation_flagged', 'policy_updated')),
  target_type text NOT NULL,
  target_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_admin ON public.moderation_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON public.moderation_actions(target_type, target_id);

CREATE TABLE IF NOT EXISTS public.message_rate_limit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (recruiter_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_message_rate_limit_logs_recruiter ON public.message_rate_limit_logs(recruiter_id, window_start);

CREATE TABLE IF NOT EXISTS public.conversation_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  flagged_by uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_flags_conversation ON public.conversation_flags(conversation_id);

CREATE TABLE IF NOT EXISTS public.account_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  suspended_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_suspensions_user ON public.account_suspensions(user_id);

CREATE TABLE IF NOT EXISTS public.recruiter_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  verified boolean NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recruiter_verification_events_recruiter ON public.recruiter_verification_events(recruiter_id);

CREATE TABLE IF NOT EXISTS public.moderation_comment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.moderation_reports(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_comment_log_report ON public.moderation_comment_log(report_id);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_source text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id);

CREATE TABLE IF NOT EXISTS public.policy_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  violation_type text NOT NULL CHECK (violation_type IN ('contact_sharing', 'profanity', 'grooming', 'harassment', 'other')),
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_violations_user ON public.policy_violations(user_id);

CREATE TABLE IF NOT EXISTS public.safety_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_notifications_user ON public.safety_notifications(user_id);

CREATE TABLE IF NOT EXISTS public.recruiter_onboarding_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepted_on timestamptz NOT NULL DEFAULT NOW(),
  ip_address text
);

CREATE INDEX IF NOT EXISTS idx_recruiter_onboarding_acceptances ON public.recruiter_onboarding_acceptances(recruiter_id);

CREATE TABLE IF NOT EXISTS public.contact_sharing_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_body text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_sharing_attempts_sender ON public.contact_sharing_attempts(sender_id);

CREATE TABLE IF NOT EXISTS public.blocked_message_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_body text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_message_attempts_sender ON public.blocked_message_attempts(sender_id);

CREATE TABLE IF NOT EXISTS public.user_conduct_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  violation_type text NOT NULL CHECK (violation_type IN ('unpaid_work_pressure', 'personal_data_request', 'harassment', 'off_platform_contact', 'other')),
  details text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_conduct_violations_user ON public.user_conduct_violations(user_id);

CREATE TABLE IF NOT EXISTS public.youth_protection_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  flagged_by uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youth_protection_flags_user ON public.youth_protection_flags(user_id);

CREATE TABLE IF NOT EXISTS public.conversation_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_audit_events_conversation ON public.conversation_audit_events(conversation_id);

CREATE OR REPLACE FUNCTION public.is_restricted_contact(text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN $1 ~* '\\b(?:whatsapp|wa\\.me|telegram|discord(?:app)?\\.com|discordtag|snapchat|snap\\.chat|instagram|insta|tiktok|mailto:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\+?[0-9][0-9 .()-]{6,}|#\d{4})\\b';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.get_blocked_user_relation(uid uuid, other uuid)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = uid AND blocked_id = other)
       OR (blocker_id = other AND blocked_id = uid)
  );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.prevent_blocked_or_restricted_message()
RETURNS TRIGGER AS $$
DECLARE
  conv record;
  user_role text;
  recent_count int;
  other_user uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conversation does not exist';
    END IF;
    other_user := CASE WHEN NEW.sender_id = conv.recruiter_id THEN conv.student_id ELSE conv.recruiter_id END;
    IF public.get_blocked_user_relation(NEW.sender_id, other_user) THEN
      RAISE EXCEPTION 'Messaging is blocked between these users.';
    END IF;
    IF public.is_restricted_contact(NEW.body) THEN
      INSERT INTO public.blocked_message_attempts(sender_id, conversation_id, message_body, reason)
      VALUES (NEW.sender_id, NEW.conversation_id, NEW.body, 'restricted_contact_shared');
      RAISE EXCEPTION 'For safety and platform trust, direct personal contact sharing is restricted.';
    END IF;
    SELECT role INTO user_role FROM public.users WHERE id = NEW.sender_id;
    IF user_role = 'recruiter' THEN
      IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.sender_id AND verified_recruiter) THEN
        RAISE EXCEPTION 'Recruiter must be verified before messaging.';
      END IF;
      SELECT count(*) INTO recent_count FROM public.messages
      WHERE sender_id = NEW.sender_id
        AND created_at >= NOW() - INTERVAL '60 seconds';
      IF recent_count >= 3 THEN
        RAISE EXCEPTION 'Please wait before sending another message. This helps prevent spam.';
      END IF;
      SELECT count(*) INTO recent_count FROM public.messages
      WHERE sender_id = NEW.sender_id
        AND created_at >= NOW() - INTERVAL '24 hours';
      IF recent_count >= 30 THEN
        RAISE EXCEPTION 'Free recruiters are limited to 30 messages per 24 hours. Contact support for expanded access.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.prevent_blocked_or_restricted_creator_message()
RETURNS TRIGGER AS $$
DECLARE
  conv record;
  other_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO conv FROM public.creator_conversations WHERE id = NEW.creator_conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Creator conversation does not exist';
    END IF;
    other_id := CASE WHEN NEW.sender_id = conv.creator_one_id THEN conv.creator_two_id ELSE conv.creator_one_id END;
    IF public.get_blocked_user_relation(NEW.sender_id, other_id) THEN
      RAISE EXCEPTION 'Messaging is blocked between these users.';
    END IF;
    IF public.is_restricted_contact(NEW.body) THEN
      INSERT INTO public.blocked_message_attempts(sender_id, conversation_id, message_body, reason)
      VALUES (NEW.sender_id, NULL, NEW.body, 'restricted_contact_shared');
      RAISE EXCEPTION 'For safety and platform trust, direct personal contact sharing is restricted.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.prevent_blocked_conversation_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.get_blocked_user_relation(NEW.recruiter_id, NEW.student_id) THEN
      RAISE EXCEPTION 'A block exists between these users and prevents creating a conversation.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.recruiter_id AND verified_recruiter) THEN
      RAISE EXCEPTION 'Recruiter must be verified before creating a student conversation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.update_timestamp_on_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_message_body_change ON public.messages;
CREATE TRIGGER trg_prevent_message_body_change
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_blocked_or_restricted_message();

DROP TRIGGER IF EXISTS trg_prevent_creator_message_body_change ON public.creator_messages;
CREATE TRIGGER trg_prevent_creator_message_body_change
  BEFORE INSERT OR UPDATE ON public.creator_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_blocked_or_restricted_creator_message();

DROP TRIGGER IF EXISTS trg_prevent_blocked_conversation_insert ON public.conversations;
CREATE TRIGGER trg_prevent_blocked_conversation_insert
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_blocked_conversation_insert();

DROP TRIGGER IF EXISTS set_updated_at_moderation_reports ON public.moderation_reports;
CREATE TRIGGER set_updated_at_moderation_reports
  BEFORE UPDATE ON public.moderation_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp_on_change();

DROP TRIGGER IF EXISTS set_updated_at_policy_violations ON public.policy_violations;
CREATE TRIGGER set_updated_at_policy_violations
  BEFORE UPDATE ON public.policy_violations
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp_on_change();

CREATE OR REPLACE FUNCTION public.log_audit_event(actor uuid, event_type text, target_type text, target_id uuid, details jsonb)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, event_type, event_source, target_type, target_id, details)
  VALUES (actor, event_type, 'platform', target_type, target_id, details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_recruiter_policy_acceptance(recruiter uuid, ip_address text)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.recruiter_onboarding_acceptances (recruiter_id, ip_address)
  VALUES (recruiter, ip_address);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



-- ────────────────────────────────────────────────────────────
-- 4. AUTO-UPDATE updated_at TRIGGER
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_student_profiles ON public.student_profiles;
CREATE TRIGGER set_updated_at_student_profiles
  BEFORE UPDATE ON public.student_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_projects ON public.projects;
CREATE TRIGGER set_updated_at_projects
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_messages ENABLE ROW LEVEL SECURITY;


-- ── HELPER FUNCTION: get current user's role ──────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ── USERS TABLE POLICIES ──────────────────────────────────

DROP POLICY IF EXISTS "users_select_authenticated" ON public.users;
-- Anyone authenticated can read users (needed for recruiter browsing)
CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "users_insert_own" ON public.users;
-- Users can insert their own row (happens at signup)
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "users_update_own" ON public.users;
-- Users can update their own row only
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "users_update_admin" ON public.users;
-- Admins can update any user (for recruiter verification, role changes, etc.)
CREATE POLICY "users_update_admin"
  ON public.users FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "users_delete_admin" ON public.users;
-- Only admins can delete users
CREATE POLICY "users_delete_admin"
  ON public.users FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'admin');


-- ── STUDENT PROFILES POLICIES ─────────────────────────────

DROP POLICY IF EXISTS "student_profiles_select_authenticated" ON public.student_profiles;
-- Authenticated users can read public student profiles; owners and admins can read hidden ones too
CREATE POLICY "student_profiles_select_authenticated"
  ON public.student_profiles FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    OR user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "student_profiles_insert_own" ON public.student_profiles;
-- Students can insert their own profile
CREATE POLICY "student_profiles_insert_own"
  ON public.student_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "student_profiles_update_own_or_admin" ON public.student_profiles;
-- Students can update only their own profile; admins can update any
CREATE POLICY "student_profiles_update_own_or_admin"
  ON public.student_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "student_profiles_delete_own_or_admin" ON public.student_profiles;
-- Students can delete their own profile; admins can delete any
CREATE POLICY "student_profiles_delete_own_or_admin"
  ON public.student_profiles FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');


-- ── PROJECTS POLICIES ────────────────────────────────────

DROP POLICY IF EXISTS "projects_select_authenticated" ON public.projects;
-- Authenticated users can read public projects; owners and admins can read hidden ones too
CREATE POLICY "projects_select_authenticated"
  ON public.projects FOR SELECT
  TO authenticated
  USING (
    visible = true
    OR user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
-- Students can insert their own projects
CREATE POLICY "projects_insert_own"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "projects_update_own_or_admin" ON public.projects;
-- Students can update only their own projects; admins can update any
CREATE POLICY "projects_update_own_or_admin"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "projects_delete_own_or_admin" ON public.projects;
-- Students can delete their own projects; admins can delete any
CREATE POLICY "projects_delete_own_or_admin"
  ON public.projects FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "contact_requests_select_own" ON public.contact_requests;
CREATE POLICY "contact_requests_select_own"
  ON public.contact_requests FOR SELECT
  TO authenticated
  USING (recruiter_id = auth.uid() OR student_id = auth.uid());

DROP POLICY IF EXISTS "contact_requests_insert_recruiter" ON public.contact_requests;
CREATE POLICY "contact_requests_insert_recruiter"
  ON public.contact_requests FOR INSERT
  TO authenticated
  WITH CHECK (recruiter_id = auth.uid());

DROP POLICY IF EXISTS "contact_requests_update_own" ON public.contact_requests;
CREATE POLICY "contact_requests_update_own"
  ON public.contact_requests FOR UPDATE
  TO authenticated
  USING (recruiter_id = auth.uid() OR student_id = auth.uid())
  WITH CHECK (recruiter_id = auth.uid() OR student_id = auth.uid());

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.get_my_role() = 'recruiter'
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
CREATE POLICY "conversations_select_participant"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (recruiter_id = auth.uid() OR student_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "conversations_insert_recruiter_or_student" ON public.conversations;
CREATE POLICY "conversations_insert_recruiter_or_student"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    recruiter_id <> student_id
    AND (
      (recruiter_id = auth.uid() AND public.get_my_role() = 'recruiter')
      OR (student_id = auth.uid() AND public.get_my_role() = 'student')
    )
    AND project_id IS NOT NULL
  );

DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;
CREATE POLICY "messages_select_participant"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = conversation_id
          AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid())
      )
    )
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "messages_insert_sender_participant" ON public.messages;
CREATE POLICY "messages_insert_sender_participant"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid())
        AND c.recruiter_id <> c.student_id
        AND c.project_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "messages_update_participant" ON public.messages;
CREATE POLICY "messages_update_participant"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.recruiter_id = auth.uid() OR c.student_id = auth.uid())
    )
  );

-- Prevent non-senders from changing message body: enforced by trigger
CREATE OR REPLACE FUNCTION public.prevent_message_body_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.body IS DISTINCT FROM NEW.body) AND (auth.uid()::text <> OLD.sender_id::text) THEN
      RAISE EXCEPTION 'Only the message sender may modify the message body';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_message_body_change ON public.messages;
CREATE TRIGGER trg_prevent_message_body_change
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_message_body_change();

DROP POLICY IF EXISTS "creator_conversations_select_participant" ON public.creator_conversations;
CREATE POLICY "creator_conversations_select_participant"
  ON public.creator_conversations FOR SELECT
  TO authenticated
  USING (creator_one_id = auth.uid() OR creator_two_id = auth.uid());

DROP POLICY IF EXISTS "creator_conversations_insert_creator" ON public.creator_conversations;
CREATE POLICY "creator_conversations_insert_creator"
  ON public.creator_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() = 'student'
    AND initiator_id = auth.uid()
    AND (creator_one_id = auth.uid() OR creator_two_id = auth.uid())
    AND creator_one_id <> creator_two_id
    AND creator_one_id::text < creator_two_id::text
    AND project_id IS NOT NULL
  );

DROP POLICY IF EXISTS "creator_messages_select_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_select_participant"
  ON public.creator_messages FOR SELECT
  TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1
        FROM public.creator_conversations c
        WHERE c.id = creator_conversation_id
          AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
      )
    )
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "creator_messages_insert_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_insert_participant"
  ON public.creator_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.get_my_role() = 'student'
    AND EXISTS (
      SELECT 1
      FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
        AND c.creator_one_id <> c.creator_two_id
        AND c.project_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "creator_messages_update_participant" ON public.creator_messages;
CREATE POLICY "creator_messages_update_participant"
  ON public.creator_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.creator_conversations c
      WHERE c.id = creator_conversation_id
        AND (c.creator_one_id = auth.uid() OR c.creator_two_id = auth.uid())
    )
  );

-- Prevent non-senders from changing creator message body
CREATE OR REPLACE FUNCTION public.prevent_creator_message_body_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.body IS DISTINCT FROM NEW.body) AND (auth.uid()::text <> OLD.sender_id::text) THEN
      RAISE EXCEPTION 'Only the message sender may modify the message body';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_creator_message_body_change ON public.creator_messages;
CREATE TRIGGER trg_prevent_creator_message_body_change
  BEFORE UPDATE ON public.creator_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_creator_message_body_change();

-- ── RLS: Trust & Safety tables (basic policies) ─────────────────────────────

-- blocked_users: participants and admins can view; users can insert/delete their own blocks
DROP POLICY IF EXISTS "blocked_users_select" ON public.blocked_users;
CREATE POLICY "blocked_users_select" ON public.blocked_users FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "blocked_users_insert" ON public.blocked_users;
CREATE POLICY "blocked_users_insert" ON public.blocked_users FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocker_id <> blocked_id);

DROP POLICY IF EXISTS "blocked_users_delete" ON public.blocked_users;
CREATE POLICY "blocked_users_delete" ON public.blocked_users FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid() OR public.get_my_role() = 'admin');

-- moderation_reports: reporter or admin can view/insert; admins review/update
DROP POLICY IF EXISTS "moderation_reports_select" ON public.moderation_reports;
CREATE POLICY "moderation_reports_select" ON public.moderation_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid() OR reported_user_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "moderation_reports_insert" ON public.moderation_reports;
CREATE POLICY "moderation_reports_insert" ON public.moderation_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "moderation_reports_update" ON public.moderation_reports;
CREATE POLICY "moderation_reports_update" ON public.moderation_reports FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'admin' OR reporter_id = auth.uid())
  WITH CHECK (public.get_my_role() = 'admin' OR reporter_id = auth.uid());

-- blocked_message_attempts: allow actors to see their own attempts and admins
DROP POLICY IF EXISTS "blocked_message_attempts_select" ON public.blocked_message_attempts;
CREATE POLICY "blocked_message_attempts_select" ON public.blocked_message_attempts FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "blocked_message_attempts_insert" ON public.blocked_message_attempts;
CREATE POLICY "blocked_message_attempts_insert" ON public.blocked_message_attempts FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- policy_violations: admin-only operations (insert/select/update)
DROP POLICY IF EXISTS "policy_violations_admin_select" ON public.policy_violations;
CREATE POLICY "policy_violations_admin_select" ON public.policy_violations FOR SELECT
  TO authenticated
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "policy_violations_admin_insert" ON public.policy_violations;
CREATE POLICY "policy_violations_admin_insert" ON public.policy_violations FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "policy_violations_admin_update" ON public.policy_violations;
CREATE POLICY "policy_violations_admin_update" ON public.policy_violations FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- account_suspensions: admin-only
DROP POLICY IF EXISTS "account_suspensions_admin" ON public.account_suspensions;
CREATE POLICY "account_suspensions_admin" ON public.account_suspensions FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- basic safety: allow recruiters and students to view their own notifications/warnings
DROP POLICY IF EXISTS "blocked_message_attempts_update" ON public.blocked_message_attempts;
CREATE POLICY "blocked_message_attempts_update" ON public.blocked_message_attempts FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (sender_id = auth.uid() OR public.get_my_role() = 'admin');

-- End trust & safety RLS additions


-- ────────────────────────────────────────────────────────────
-- 6. CREATE ADMIN USER
--    IMPORTANT: Run this AFTER signing up via the app with
--    your admin email. Replace the email below with yours.
-- ────────────────────────────────────────────────────────────

-- Step 1: Sign up at /auth.html with your admin email/password
-- Step 2: Run this query to promote that user to admin:

/*
UPDATE public.users
SET role = 'admin'
WHERE email = 'admin@yourdomain.com';
*/

-- To verify:
-- SELECT id, email, role FROM public.users WHERE role = 'admin';


-- ────────────────────────────────────────────────────────────
-- 7. OPTIONAL: SEED SAMPLE DATA (for testing)
--    Only run if you want demo data. Uses fake UUIDs.
-- ────────────────────────────────────────────────────────────

/*
-- NOTE: These inserts require valid auth.users entries.
-- Instead, create real accounts via the signup form and
-- use those IDs here, or use the Supabase Auth API.

-- To check your auth user IDs:
-- SELECT id, email FROM auth.users;
*/


-- ────────────────────────────────────────────────────────────
-- 8. USEFUL VIEWS (optional, for Supabase dashboard)
-- ────────────────────────────────────────────────────────────

-- Aggregated student data view (read-only, no RLS needed here)
CREATE OR REPLACE VIEW public.student_overview AS
SELECT
  u.id,
  u.full_name,
  u.email,
  u.created_at,
  sp.headline,
  sp.location,
  sp.availability,
  sp.skills,
  COUNT(p.id) AS project_count
FROM public.users u
LEFT JOIN public.student_profiles sp ON sp.user_id = u.id
LEFT JOIN public.projects p ON p.user_id = u.id
WHERE u.role = 'student'
GROUP BY u.id, u.full_name, u.email, u.created_at, sp.headline, sp.location, sp.availability, sp.skills;


-- ============================================================
-- DONE! ✓
-- Your Solvoriz database is ready.
-- Next: update /assets/js/supabase.js with your project credentials.
-- ============================================================
