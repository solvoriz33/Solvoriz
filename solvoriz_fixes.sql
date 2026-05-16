-- ============================================================
-- SOLVORIZ PLATFORM FIXES
-- Run this in Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. SHORTLIST TABLE (save recruiter shortlists persistently)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shortlists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(recruiter_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_shortlists_recruiter_id ON public.shortlists(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_shortlists_project_id ON public.shortlists(project_id);


-- ────────────────────────────────────────────────────────────
-- 2. ACTIVITY LOG TABLE (track profile/project views & shortlists)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL
                  CHECK (action_type IN ('profile_view', 'project_view', 'shortlist', 'contact_sent')),
  target_type   TEXT NOT NULL
                  CHECK (target_type IN ('profile', 'project')),
  target_id     UUID NOT NULL,
  target_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_actor_id ON public.activity_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_target_user_id ON public.activity_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON public.activity_log(created_at DESC);


-- ────────────────────────────────────────────────────────────
-- 3. UPDATE contact_requests TABLE (add project_id if missing)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.contact_requests
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;


-- ────────────────────────────────────────────────────────────
-- 4. RLS POLICIES FOR SHORTLISTS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.shortlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shortlists_select_own" ON public.shortlists;
CREATE POLICY "shortlists_select_own"
  ON public.shortlists FOR SELECT
  TO authenticated
  USING (recruiter_id = auth.uid());

DROP POLICY IF EXISTS "shortlists_insert_own" ON public.shortlists;
CREATE POLICY "shortlists_insert_own"
  ON public.shortlists FOR INSERT
  TO authenticated
  WITH CHECK (recruiter_id = auth.uid());

DROP POLICY IF EXISTS "shortlists_delete_own" ON public.shortlists;
CREATE POLICY "shortlists_delete_own"
  ON public.shortlists FOR DELETE
  TO authenticated
  USING (recruiter_id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- 5. RLS POLICIES FOR ACTIVITY_LOG
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_log_select_own" ON public.activity_log;
-- Users can see activity log about themselves; admins can see all
CREATE POLICY "activity_log_select_own"
  ON public.activity_log FOR SELECT
  TO authenticated
  USING (
    target_user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "activity_log_insert_any" ON public.activity_log;
-- Any authenticated user can log their own activity
CREATE POLICY "activity_log_insert_any"
  ON public.activity_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());
