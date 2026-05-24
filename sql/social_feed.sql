-- Solvoriz social feed: real posts, comments, and reactions.
-- Apply this in Supabase before enabling quick posts on production.

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'update'
    CHECK (kind IN ('update', 'question', 'build_log', 'launch')),
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1200),
  image_url text,
  visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.social_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 800),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'build' CHECK (reaction IN ('build', 'useful', 'ship')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_created_at ON public.social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_author_id ON public.social_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_project_id ON public.social_posts(project_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_post_id ON public.social_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_parent_id ON public.social_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_social_reactions_target ON public.social_reactions(target_type, target_id);

DROP TRIGGER IF EXISTS set_updated_at_social_posts ON public.social_posts;
CREATE TRIGGER set_updated_at_social_posts
  BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_social_comments ON public.social_comments;
CREATE TRIGGER set_updated_at_social_comments
  BEFORE UPDATE ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_posts_read_public" ON public.social_posts;
CREATE POLICY "social_posts_read_public"
  ON public.social_posts FOR SELECT
  TO authenticated
  USING (visibility = 'public' OR author_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "social_posts_insert_own" ON public.social_posts;
CREATE POLICY "social_posts_insert_own"
  ON public.social_posts FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "social_posts_update_own_or_admin" ON public.social_posts;
CREATE POLICY "social_posts_update_own_or_admin"
  ON public.social_posts FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (author_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "social_posts_delete_own_or_admin" ON public.social_posts;
CREATE POLICY "social_posts_delete_own_or_admin"
  ON public.social_posts FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "social_comments_read_public_posts" ON public.social_comments;
CREATE POLICY "social_comments_read_public_posts"
  ON public.social_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.social_posts p
      WHERE p.id = social_comments.post_id
        AND (p.visibility = 'public' OR p.author_id = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS "social_comments_insert_own" ON public.social_comments;
CREATE POLICY "social_comments_insert_own"
  ON public.social_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.social_posts p
      WHERE p.id = post_id
        AND p.visibility = 'public'
    )
  );

DROP POLICY IF EXISTS "social_comments_update_own_or_admin" ON public.social_comments;
CREATE POLICY "social_comments_update_own_or_admin"
  ON public.social_comments FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (author_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "social_comments_delete_own_or_admin" ON public.social_comments;
CREATE POLICY "social_comments_delete_own_or_admin"
  ON public.social_comments FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "social_reactions_read" ON public.social_reactions;
CREATE POLICY "social_reactions_read"
  ON public.social_reactions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "social_reactions_insert_own" ON public.social_reactions;
CREATE POLICY "social_reactions_insert_own"
  ON public.social_reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "social_reactions_delete_own_or_admin" ON public.social_reactions;
CREATE POLICY "social_reactions_delete_own_or_admin"
  ON public.social_reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.social_reactions TO authenticated;
