-- Solvoriz core architecture repair.
-- Run this in Supabase SQL Editor after the original setup scripts.
-- This fixes the root backend blockers for DMs, community messages,
-- realtime, sender identity, profile-launch linkage, and project deletes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------------
-- 1) Identity and profile consistency
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_username(raw_username text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(lower(trim(coalesce(raw_username, ''))), '[^a-z0-9_]+', '', 'g'), '');
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS requested_role text DEFAULT 'student';

UPDATE public.users
SET
  username = CASE
    WHEN public.normalize_username(username) IS NOT NULL AND char_length(public.normalize_username(username)) >= 3
      THEN public.normalize_username(username)
    WHEN public.normalize_username(split_part(email, '@', 1)) IS NOT NULL AND char_length(public.normalize_username(split_part(email, '@', 1))) >= 3
      THEN public.normalize_username(split_part(email, '@', 1))
    ELSE 'builder_' || substr(replace(id::text, '-', ''), 1, 8)
  END,
  display_name = coalesce(nullif(trim(display_name), ''), nullif(trim(full_name), ''), split_part(email, '@', 1), 'Builder')
WHERE username IS NULL
   OR display_name IS NULL
   OR username <> public.normalize_username(username)
   OR char_length(coalesce(username, '')) < 3;

WITH ranked AS (
  SELECT
    id,
    username,
    row_number() OVER (PARTITION BY username ORDER BY created_at, id) AS rn
  FROM public.users
  WHERE username IS NOT NULL
)
UPDATE public.users u
SET username = left(r.username, 21) || '_' || substr(replace(u.id::text, '-', ''), 1, 8)
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm ON public.users USING gin (display_name gin_trgm_ops);

INSERT INTO public.student_profiles(user_id, handle, visibility, discoverable)
SELECT u.id, u.username, 'public', true
FROM public.users u
WHERE u.role = 'student'
  AND NOT EXISTS (SELECT 1 FROM public.student_profiles sp WHERE sp.user_id = u.id)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------
-- 2) Direct messages: remove stale recruiter-only architecture
-- ------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS initiator_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.conversations ALTER COLUMN project_id DROP NOT NULL;

-- These old triggers are the main DM blocker: they require recruiter role,
-- verified recruiter status, and project ownership even for builder DMs.
DROP TRIGGER IF EXISTS trg_prevent_blocked_conversation_insert ON public.conversations;
DROP TRIGGER IF EXISTS trg_validate_conversation_membership ON public.conversations;

DROP INDEX IF EXISTS idx_conversations_direct_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_direct_unique
  ON public.conversations (least(recruiter_id, student_id), greatest(recruiter_id, student_id))
  WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_participant_last
  ON public.conversations(recruiter_id, student_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON public.messages(sender_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_direct_conversation(p_other_user_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  left_id uuid;
  right_id uuid;
  existing public.conversations%ROWTYPE;
  created public.conversations%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = me THEN
    RAISE EXCEPTION 'Choose another user to message.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_other_user_id) THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
  IF public.get_blocked_user_relation(me, p_other_user_id) THEN
    RAISE EXCEPTION 'Messaging is blocked between these users.';
  END IF;

  left_id := least(me, p_other_user_id);
  right_id := greatest(me, p_other_user_id);

  SELECT * INTO existing
  FROM public.conversations c
  WHERE least(c.recruiter_id, c.student_id) = left_id
    AND greatest(c.recruiter_id, c.student_id) = right_id
    AND c.project_id IS NOT DISTINCT FROM p_project_id
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF existing.id IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO public.conversations(recruiter_id, student_id, project_id, initiator_id, last_message_at)
  VALUES(left_id, right_id, p_project_id, me, now())
  RETURNING * INTO created;

  RETURN created;
END;
$$;

DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
CREATE POLICY "conversations_select_participant"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (auth.uid() IN (recruiter_id, student_id) OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "conversations_insert_recruiter_or_student" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_recruiter_only" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_authenticated_pair" ON public.conversations;
CREATE POLICY "conversations_insert_authenticated_pair"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    recruiter_id <> student_id
    AND (auth.uid() IN (recruiter_id, student_id) OR public.get_my_role() = 'admin')
  );

DROP POLICY IF EXISTS "conversations_update_participant" ON public.conversations;
CREATE POLICY "conversations_update_participant"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (recruiter_id, student_id) OR public.get_my_role() = 'admin')
  WITH CHECK (auth.uid() IN (recruiter_id, student_id) OR public.get_my_role() = 'admin');

-- ------------------------------------------------------------------
-- 3) Message send/edit/delete/read receipts
-- ------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.creator_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.prevent_blocked_or_restricted_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv public.conversations%ROWTYPE;
  recent_count integer;
BEGIN
  NEW.body := left(trim(coalesce(NEW.body, '')), 1000);
  IF NEW.body = '' THEN
    RAISE EXCEPTION 'Message cannot be empty.';
  END IF;

  SELECT * INTO conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversation does not exist.';
  END IF;
  IF NEW.sender_id NOT IN (conv.recruiter_id, conv.student_id) THEN
    RAISE EXCEPTION 'Sender is not part of this conversation.';
  END IF;
  IF public.get_blocked_user_relation(conv.recruiter_id, conv.student_id) THEN
    RAISE EXCEPTION 'Messaging is blocked between these users.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO recent_count
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND created_at > now() - interval '1 minute';
    IF recent_count >= 20 THEN
      RAISE EXCEPTION 'Please slow down before sending more messages.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_message_body_change ON public.messages;
CREATE TRIGGER trg_prevent_message_body_change
  BEFORE INSERT OR UPDATE OF body ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_blocked_or_restricted_message();

CREATE OR REPLACE FUNCTION public.enforce_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.allow_message_read_update', true) = 'on' THEN
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
         OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
         OR NEW.body IS DISTINCT FROM OLD.body
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Read receipt updates cannot change message identity.';
      END IF;
      RETURN NEW;
    END IF;

    IF auth.uid() <> OLD.sender_id AND public.get_my_role() <> 'admin' THEN
      RAISE EXCEPTION 'Only the sender may edit this message.';
    END IF;
    NEW.edited_at := coalesce(NEW.edited_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_message_immutability ON public.messages;
CREATE TRIGGER trg_enforce_message_immutability
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_immutability();

DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;
CREATE POLICY "messages_select_participant"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() IN (c.recruiter_id, c.student_id)
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
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() IN (c.recruiter_id, c.student_id)
    )
  );

DROP POLICY IF EXISTS "messages_update_participant" ON public.messages;
DROP POLICY IF EXISTS "messages_update_sender_or_read" ON public.messages;
CREATE POLICY "messages_update_sender_or_read"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() IN (c.recruiter_id, c.student_id)
    )
    OR public.get_my_role() = 'admin'
  )
  WITH CHECK (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() IN (c.recruiter_id, c.student_id)
    )
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "messages_delete_sender_or_admin" ON public.messages;
CREATE POLICY "messages_delete_sender_or_admin"
  ON public.messages FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid() OR public.get_my_role() = 'admin');

CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = coalesce(NEW.created_at, now())
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversation_last_message ON public.messages;
CREATE TRIGGER trg_touch_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND auth.uid() IN (c.recruiter_id, c.student_id)
  ) THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  PERFORM set_config('app.allow_message_read_update', 'on', true);
  UPDATE public.messages
  SET read = true
  WHERE conversation_id = p_conversation_id
    AND sender_id <> auth.uid()
    AND read = false;
END;
$$;

-- ------------------------------------------------------------------
-- 4) Community channels
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  description text,
  creator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups_select_authenticated" ON public.groups;
CREATE POLICY "groups_select_authenticated" ON public.groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "groups_insert_authenticated" ON public.groups;
CREATE POLICY "groups_insert_authenticated" ON public.groups FOR INSERT TO authenticated WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS "group_members_select_authenticated" ON public.group_members;
CREATE POLICY "group_members_select_authenticated" ON public.group_members FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "group_members_insert_self" ON public.group_members;
CREATE POLICY "group_members_insert_self" ON public.group_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "group_messages_select_member" ON public.group_messages;
CREATE POLICY "group_messages_select_member" ON public.group_messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_messages.group_id
      AND gm.user_id = auth.uid()
  )
  OR public.get_my_role() = 'admin'
);

DROP POLICY IF EXISTS "group_messages_insert_member" ON public.group_messages;
CREATE POLICY "group_messages_insert_member" ON public.group_messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_messages.group_id
      AND gm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "group_messages_update_sender_or_admin" ON public.group_messages;
CREATE POLICY "group_messages_update_sender_or_admin" ON public.group_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (sender_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "group_messages_delete_sender_or_admin" ON public.group_messages;
CREATE POLICY "group_messages_delete_sender_or_admin" ON public.group_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.get_my_role() = 'admin');

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_description text DEFAULT NULL)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created public.groups%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  INSERT INTO public.groups(name, description, creator_id)
  VALUES(trim(p_name), nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  RETURNING * INTO created;

  INSERT INTO public.group_members(group_id, user_id, role)
  VALUES(created.id, auth.uid(), 'owner')
  ON CONFLICT DO NOTHING;

  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  INSERT INTO public.group_members(group_id, user_id)
  VALUES(p_group_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$;

-- ------------------------------------------------------------------
-- 5) Launch/profile linkage and safe delete
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'project-assets',
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_upvotes (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.project_bookmarks (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_upvotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_assets_owner_or_admin" ON public.project_assets;
CREATE POLICY "project_assets_owner_or_admin" ON public.project_assets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_assets.project_id AND (p.user_id = auth.uid() OR public.get_my_role() = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_assets.project_id AND (p.user_id = auth.uid() OR public.get_my_role() = 'admin')));

DROP POLICY IF EXISTS "project_upvotes_read" ON public.project_upvotes;
CREATE POLICY "project_upvotes_read" ON public.project_upvotes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "project_upvotes_write_own" ON public.project_upvotes;
CREATE POLICY "project_upvotes_write_own" ON public.project_upvotes FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "project_bookmarks_write_own" ON public.project_bookmarks;
CREATE POLICY "project_bookmarks_write_own" ON public.project_bookmarks FOR ALL TO authenticated
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
  IF project_owner IS NULL THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF project_owner <> auth.uid() AND public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only the project owner or an admin can delete this project.';
  END IF;

  IF to_regclass('public.social_posts') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM public.social_posts WHERE project_id = $1'
    INTO post_ids USING p_project_id;

    IF to_regclass('public.social_comments') IS NOT NULL THEN
      EXECUTE 'SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM public.social_comments WHERE post_id = ANY($1)'
      INTO comment_ids USING post_ids;
    ELSE
      comment_ids := '{}'::uuid[];
    END IF;

    IF to_regclass('public.social_reactions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.social_reactions WHERE target_type = ''comment'' AND target_id = ANY($1)' USING comment_ids;
      EXECUTE 'DELETE FROM public.social_reactions WHERE target_type = ''post'' AND target_id = ANY($1)' USING post_ids;
    END IF;

    IF to_regclass('public.social_comments') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.social_comments WHERE post_id = ANY($1)' USING post_ids;
    END IF;

    EXECUTE 'DELETE FROM public.social_posts WHERE id = ANY($1)' USING post_ids;
  END IF;

  DELETE FROM storage.objects o
  USING public.project_assets a
  WHERE a.project_id = p_project_id
    AND o.bucket_id = a.bucket_id
    AND o.name = a.storage_path;

  DELETE FROM public.project_assets WHERE project_id = p_project_id;
  DELETE FROM public.project_upvotes WHERE project_id = p_project_id;
  DELETE FROM public.project_bookmarks WHERE project_id = p_project_id;
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
    coalesce(u.display_name, u.full_name, u.username, 'Unknown Builder') AS display_name,
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
        'title', p.title,
        'created_at', p.created_at,
        'kind', 'launch'
      ) ORDER BY p.created_at DESC)
      FROM public.projects p
      WHERE p.user_id = sp.user_id
        AND p.visible = true
        AND coalesce(p.review_status, 'active') <> 'flagged'
    ) AS timeline
  INTO profile_row
  FROM public.student_profiles sp
  JOIN public.users u ON u.id = sp.user_id
  WHERE (sp.handle = p_handle OR u.username = p_handle)
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
    'skills', coalesce(profile_row.skills, ARRAY[]::text[]),
    'discoverable', profile_row.discoverable,
    'featured', profile_row.featured,
    'review_status', profile_row.review_status,
    'followers', 0,
    'projects', coalesce(profile_row.projects, '[]'::jsonb),
    'timeline', coalesce(profile_row.timeline, '[]'::jsonb)
  );
END;
$$;

-- ------------------------------------------------------------------
-- 6) Notifications and realtime publication
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'admin');

CREATE OR REPLACE FUNCTION public.send_platform_notification(
  p_target_user_id uuid,
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_row public.notifications;
  payload_project_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  payload_project_id := NULLIF(p_payload ->> 'project_id', '')::uuid;

  IF p_target_user_id = auth.uid() THEN
    NULL;
  ELSIF public.get_my_role() = 'admin' THEN
    NULL;
  ELSIF p_type IN ('contact_request', 'creator_discussion') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE auth.uid() IN (c.recruiter_id, c.student_id)
        AND p_target_user_id IN (c.recruiter_id, c.student_id)
        AND (
          payload_project_id IS NULL
          OR c.project_id IS NULL
          OR c.project_id = payload_project_id
        )
    ) THEN
      RAISE EXCEPTION 'Notification target is not tied to an existing conversation.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cross-user notifications are restricted.';
  END IF;

  INSERT INTO public.notifications(user_id, type, payload)
  VALUES(p_target_user_id, p_type, coalesce(p_payload, '{}'::jsonb))
  RETURNING * INTO created_row;

  RETURN created_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_direct_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.send_platform_notification(uuid, text, jsonb) TO authenticated;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.groups; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.projects; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.social_posts; EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.social_comments; EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.social_reactions; EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

-- Quick smoke checks for the SQL editor result pane.
SELECT 'core_architecture_repair_applied' AS status;
