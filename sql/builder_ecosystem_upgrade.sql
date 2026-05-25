-- Solvoriz builder ecosystem upgrade.
-- Run after supabase_setup.sql, sql/social_feed.sql, and sql/open_community_update.sql.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.creator_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.allow_message_read_update', true) = 'on' THEN
      IF NEW.body IS DISTINCT FROM OLD.body
         OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
         OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
        RAISE EXCEPTION 'Read updates cannot change message content.';
      END IF;
      RETURN NEW;
    END IF;

    IF auth.uid() <> OLD.sender_id THEN
      RAISE EXCEPTION 'Only the sender may edit this message.';
    END IF;
    NEW.edited_at := COALESCE(NEW.edited_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_creator_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.allow_message_read_update', true) = 'on' THEN
      IF NEW.body IS DISTINCT FROM OLD.body
         OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
         OR NEW.creator_conversation_id IS DISTINCT FROM OLD.creator_conversation_id THEN
        RAISE EXCEPTION 'Read updates cannot change message content.';
      END IF;
      RETURN NEW;
    END IF;

    IF auth.uid() <> OLD.sender_id THEN
      RAISE EXCEPTION 'Only the sender may edit this message.';
    END IF;
    NEW.edited_at := COALESCE(NEW.edited_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  creator_message_id uuid REFERENCES public.creator_messages(id) ON DELETE CASCADE,
  group_message_id uuid REFERENCES public.group_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (char_length(reaction) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(message_id, creator_message_id, group_message_id) = 1),
  UNIQUE (message_id, creator_message_id, group_message_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS public.project_bookmarks (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.project_upvotes (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows(following_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_upvotes_project ON public.project_upvotes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_bookmarks_user ON public.project_bookmarks(user_id, created_at DESC);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_upvotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_reactions_read_participants" ON public.message_reactions;
CREATE POLICY "message_reactions_read_participants" ON public.message_reactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "message_reactions_write_own" ON public.message_reactions;
CREATE POLICY "message_reactions_write_own" ON public.message_reactions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "follows_read" ON public.follows;
CREATE POLICY "follows_read" ON public.follows FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "follows_write_own" ON public.follows;
CREATE POLICY "follows_write_own" ON public.follows FOR ALL TO authenticated
  USING (follower_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (follower_id = auth.uid());

DROP POLICY IF EXISTS "project_bookmarks_write_own" ON public.project_bookmarks;
CREATE POLICY "project_bookmarks_write_own" ON public.project_bookmarks FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "project_upvotes_read" ON public.project_upvotes;
CREATE POLICY "project_upvotes_read" ON public.project_upvotes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "project_upvotes_write_own" ON public.project_upvotes;
CREATE POLICY "project_upvotes_write_own" ON public.project_upvotes FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.delete_project_secure(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  project_owner uuid;
  post_ids uuid[];
  comment_ids uuid[];
BEGIN
  SELECT user_id INTO project_owner FROM public.projects WHERE id = p_project_id;
  IF project_owner IS NULL THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF project_owner <> auth.uid() AND public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only the project owner or an admin can delete this project.';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO post_ids
  FROM public.social_posts
  WHERE project_id = p_project_id;

  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO comment_ids
  FROM public.social_comments
  WHERE post_id = ANY(post_ids);

  DELETE FROM public.social_reactions WHERE target_type = 'comment' AND target_id = ANY(comment_ids);
  DELETE FROM public.social_reactions WHERE target_type = 'post' AND target_id = ANY(post_ids);
  DELETE FROM public.social_comments WHERE post_id = ANY(post_ids);
  DELETE FROM public.social_posts WHERE id = ANY(post_ids);

  DELETE FROM storage.objects o
  USING public.project_assets a
  WHERE a.project_id = p_project_id
    AND o.bucket_id = a.bucket_id
    AND o.name = a.storage_path;

  DELETE FROM public.project_assets WHERE project_id = p_project_id;
  DELETE FROM public.project_comments WHERE project_id = p_project_id;
  DELETE FROM public.project_bookmarks WHERE project_id = p_project_id;
  DELETE FROM public.project_upvotes WHERE project_id = p_project_id;
  DELETE FROM public.projects WHERE id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row record;
BEGIN
  SELECT
    u.id AS user_id,
    u.full_name,
    coalesce(u.display_name, u.full_name, u.username) AS display_name,
    u.username,
    sp.handle,
    sp.age,
    coalesce(u.avatar_url, sp.avatar_url) AS avatar_url,
    sp.github_username,
    sp.headline,
    sp.bio,
    sp.location,
    sp.availability,
    sp.skills,
    sp.discoverable,
    sp.featured,
    sp.review_status,
    (SELECT count(*) FROM public.follows f WHERE f.following_id = sp.user_id) AS followers,
    (SELECT count(*) FROM public.follows f WHERE f.follower_id = sp.user_id) AS following,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'description', p.description,
        'tech_stack', p.tech_stack,
        'project_type', p.project_type,
        'image_url', p.image_url,
        'featured', p.featured,
        'demo_link', p.demo_link,
        'github_link', p.github_link,
        'visible', p.visible,
        'review_status', p.review_status,
        'created_at', p.created_at,
        'upvotes', (SELECT count(*) FROM public.project_upvotes pu WHERE pu.project_id = p.id)
      ) ORDER BY p.featured DESC, p.created_at DESC)
      FROM public.projects p
      WHERE p.user_id = sp.user_id
        AND p.visible = true
        AND coalesce(p.review_status, 'active') <> 'flagged'
    ) AS projects,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'kind', 'launch',
        'title', p.title,
        'created_at', p.created_at
      ) ORDER BY p.created_at DESC)
      FROM public.projects p
      WHERE p.user_id = sp.user_id
        AND p.visible = true
        AND coalesce(p.review_status, 'active') <> 'flagged'
      LIMIT 20
    ) AS timeline
  INTO profile_row
  FROM public.student_profiles sp
  JOIN public.users u ON u.id = sp.user_id
  WHERE sp.handle = p_handle
    AND coalesce(sp.visibility, 'public') = 'public'
    AND coalesce(sp.review_status, 'pending') <> 'flagged';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'user_id', profile_row.user_id,
    'full_name', profile_row.full_name,
    'display_name', profile_row.display_name,
    'username', profile_row.username,
    'handle', profile_row.handle,
    'age', profile_row.age,
    'avatar_url', profile_row.avatar_url,
    'github_username', profile_row.github_username,
    'headline', profile_row.headline,
    'bio', profile_row.bio,
    'location', profile_row.location,
    'availability', profile_row.availability,
    'skills', COALESCE(profile_row.skills, ARRAY[]::text[]),
    'discoverable', profile_row.discoverable,
    'featured', profile_row.featured,
    'review_status', profile_row.review_status,
    'followers', COALESCE(profile_row.followers, 0),
    'following', COALESCE(profile_row.following, 0),
    'projects', COALESCE(profile_row.projects, '[]'::jsonb),
    'timeline', COALESCE(profile_row.timeline, '[]'::jsonb)
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_bookmarks TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_upvotes TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO authenticated, anon;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.social_posts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.social_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.social_reactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.project_upvotes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
