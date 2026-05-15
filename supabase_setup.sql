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
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_verified_recruiter ON public.users(verified_recruiter);


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

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_tech_stack ON public.projects USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON public.projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_visible ON public.projects(visible);

CREATE TABLE IF NOT EXISTS public.contact_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
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
  WITH CHECK (user_id = auth.uid());


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