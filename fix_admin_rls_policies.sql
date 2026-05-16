-- ============================================================
-- FIX: Admin RLS Policies for Recruiter/Project Approvals
-- Run this in: https://app.supabase.com → your project → SQL Editor → New query
-- ============================================================

-- ── ADD MISSING ADMIN UPDATE POLICY FOR USERS ──────────────
DROP POLICY IF EXISTS "users_update_admin" ON public.users;
CREATE POLICY "users_update_admin"
  ON public.users FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── Verify policies are in place ──────────────────────────
-- SELECT * FROM pg_policies WHERE tablename = 'users' ORDER BY policyname;
