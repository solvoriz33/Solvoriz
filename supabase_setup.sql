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
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'recruiter', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);


-- ────────────────────────────────────────────────────────────
-- 2. STUDENT PROFILES TABLE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  headline      TEXT,
  bio           TEXT,
  location      TEXT,
  availability  TEXT DEFAULT 'not set'
                  CHECK (availability IN ('available', 'open', 'busy', 'not set', '')),
  skills        TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON public.student_profiles(user_id);
-- GIN index for fast skills array search
CREATE INDEX IF NOT EXISTS idx_student_profiles_skills ON public.student_profiles USING GIN(skills);


-- ────────────────────────────────────────────────────────────
-- 3. PROJECTS TABLE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  tech_stack    TEXT[] DEFAULT '{}',
  demo_link     TEXT,
  github_link   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_tech_stack ON public.projects USING GIN(tech_stack);


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


-- ── HELPER FUNCTION: get current user's role ──────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ── USERS TABLE POLICIES ──────────────────────────────────

-- Anyone authenticated can read users (needed for recruiter browsing)
CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

-- Users can insert their own row (happens at signup)
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users can update their own row only
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can delete users
CREATE POLICY "users_delete_admin"
  ON public.users FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'admin');


-- ── STUDENT PROFILES POLICIES ─────────────────────────────

-- Authenticated users can read all student profiles (recruiters browse)
CREATE POLICY "student_profiles_select_authenticated"
  ON public.student_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Students can insert their own profile
CREATE POLICY "student_profiles_insert_own"
  ON public.student_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Students can update only their own profile; admins can update any
CREATE POLICY "student_profiles_update_own_or_admin"
  ON public.student_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'admin');

-- Students can delete their own profile; admins can delete any
CREATE POLICY "student_profiles_delete_own_or_admin"
  ON public.student_profiles FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');


-- ── PROJECTS POLICIES ────────────────────────────────────

-- Authenticated users can read all projects
CREATE POLICY "projects_select_authenticated"
  ON public.projects FOR SELECT
  TO authenticated
  USING (true);

-- Students can insert their own projects
CREATE POLICY "projects_insert_own"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Students can update only their own projects; admins can update any
CREATE POLICY "projects_update_own_or_admin"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'admin');

-- Students can delete their own projects; admins can delete any
CREATE POLICY "projects_delete_own_or_admin"
  ON public.projects FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');


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