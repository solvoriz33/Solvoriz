-- Solvoriz open community, search, messaging, groups, and delete-flow update.
-- Run this after supabase_setup.sql in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  ADD COLUMN IF NOT EXISTS bio text;

UPDATE public.users
SET
  username = coalesce(public.normalize_username(username), public.normalize_username(split_part(email, '@', 1)) || substr(id::text, 1, 6)),
  display_name = coalesce(display_name, full_name, split_part(email, '@', 1))
WHERE username IS NULL OR username <> public.normalize_username(username) OR display_name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_format'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_username_format
      CHECK (username = public.normalize_username(username) AND char_length(username) BETWEEN 3 AND 30);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON public.users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm ON public.users USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_id_text_trgm ON public.users USING gin ((id::text) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.handle_user_identity_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.username := public.normalize_username(NEW.username);
  IF NEW.username IS NULL OR char_length(NEW.username) < 3 THEN
    RAISE EXCEPTION 'Username must be 3-30 characters and use letters, numbers, or underscores.';
  END IF;
  NEW.display_name := nullif(trim(coalesce(NEW.display_name, NEW.full_name, NEW.username)), '');
  NEW.full_name := coalesce(nullif(trim(NEW.full_name), ''), NEW.display_name, NEW.username);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_identity_defaults ON public.users;
CREATE TRIGGER trg_user_identity_defaults
  BEFORE INSERT OR UPDATE OF username, display_name, full_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_identity_defaults();

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.normalize_username(p_username) IS NOT NULL
    AND char_length(public.normalize_username(p_username)) BETWEEN 3 AND 30
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE username = public.normalize_username(p_username));
$$;

CREATE OR REPLACE FUNCTION public.search_profiles(p_search text DEFAULT '', p_limit integer DEFAULT 24)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  account_id text,
  headline text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.username,
    coalesce(u.display_name, u.full_name, u.username) AS display_name,
    coalesce(u.avatar_url, sp.avatar_url) AS avatar_url,
    coalesce(u.bio, sp.bio, '') AS bio,
    u.id::text AS account_id,
    coalesce(sp.headline, '') AS headline
  FROM public.users u
  LEFT JOIN public.student_profiles sp ON sp.user_id = u.id
  WHERE coalesce(u.suspended_until, now() - interval '1 second') <= now()
    AND (
      nullif(trim(coalesce(p_search, '')), '') IS NULL
      OR u.username ILIKE '%' || public.normalize_username(p_search) || '%'
      OR coalesce(u.display_name, u.full_name, '') ILIKE '%' || trim(p_search) || '%'
      OR u.id::text ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY
    CASE WHEN u.username = public.normalize_username(p_search) THEN 0 ELSE 1 END,
    coalesce(u.display_name, u.full_name, u.username) ASC
  LIMIT least(greatest(coalesce(p_limit, 24), 1), 50);
$$;

DROP POLICY IF EXISTS "student_profiles_select_authenticated" ON public.student_profiles;
CREATE POLICY "student_profiles_select_authenticated"
  ON public.student_profiles FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS initiator_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.conversations ALTER COLUMN project_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_direct_unique
  ON public.conversations (least(recruiter_id, student_id), greatest(recruiter_id, student_id))
  WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_student ON public.conversations(student_id);
CREATE INDEX IF NOT EXISTS idx_conversations_recruiter ON public.conversations(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages(sender_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_direct_conversation(p_other_user_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  existing public.conversations%ROWTYPE;
  created public.conversations%ROWTYPE;
  left_id uuid;
  right_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = me THEN RAISE EXCEPTION 'Choose another user to message.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_other_user_id) THEN RAISE EXCEPTION 'User not found.'; END IF;

  left_id := least(me, p_other_user_id);
  right_id := greatest(me, p_other_user_id);

  SELECT * INTO existing
  FROM public.conversations c
  WHERE least(c.recruiter_id, c.student_id) = left_id
    AND greatest(c.recruiter_id, c.student_id) = right_id
    AND c.project_id IS NOT DISTINCT FROM p_project_id
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF existing.id IS NOT NULL THEN RETURN existing; END IF;

  INSERT INTO public.conversations (recruiter_id, student_id, project_id, initiator_id, last_message_at)
  VALUES (left_id, right_id, p_project_id, me, now())
  RETURNING * INTO created;

  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversation_last_message ON public.messages;
CREATE TRIGGER trg_touch_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

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
  IF TG_OP = 'UPDATE' AND OLD.body IS DISTINCT FROM NEW.body AND auth.uid() <> OLD.sender_id THEN
    RAISE EXCEPTION 'Only the sender can edit a message.';
  END IF;

  NEW.body := left(trim(coalesce(NEW.body, '')), 1000);
  IF NEW.body = '' THEN RAISE EXCEPTION 'Message cannot be empty.'; END IF;

  SELECT * INTO conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation does not exist.'; END IF;
  IF NEW.sender_id NOT IN (conv.recruiter_id, conv.student_id) THEN RAISE EXCEPTION 'Sender is not part of this conversation.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = conv.recruiter_id AND b.blocked_id = conv.student_id)
       OR (b.blocker_id = conv.student_id AND b.blocked_id = conv.recruiter_id)
  ) THEN
    RAISE EXCEPTION 'Messaging is blocked between these users.';
  END IF;

  SELECT count(*) INTO recent_count
  FROM public.messages
  WHERE sender_id = NEW.sender_id AND created_at > now() - interval '1 minute';
  IF recent_count >= 20 THEN RAISE EXCEPTION 'Please slow down before sending more messages.'; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_message_body_change ON public.messages;
CREATE TRIGGER trg_prevent_message_body_change
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_blocked_or_restricted_message();

DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
CREATE POLICY "conversations_select_participant"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (recruiter_id = auth.uid() OR student_id = auth.uid() OR public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "conversations_insert_recruiter_or_student" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_authenticated_pair" ON public.conversations;
CREATE POLICY "conversations_insert_authenticated_pair"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (recruiter_id <> student_id AND (auth.uid() IN (recruiter_id, student_id) OR public.get_my_role() = 'admin'));

DROP POLICY IF EXISTS "messages_insert_sender_participant" ON public.messages;
CREATE POLICY "messages_insert_sender_participant"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND auth.uid() IN (c.recruiter_id, c.student_id)
    )
  );

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
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups_select_authenticated" ON public.groups;
CREATE POLICY "groups_select_authenticated" ON public.groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "groups_insert_authenticated" ON public.groups;
CREATE POLICY "groups_insert_authenticated" ON public.groups FOR INSERT TO authenticated WITH CHECK (creator_id = auth.uid());
DROP POLICY IF EXISTS "groups_update_owner_or_admin" ON public.groups;
CREATE POLICY "groups_update_owner_or_admin" ON public.groups FOR UPDATE TO authenticated USING (creator_id = auth.uid() OR public.get_my_role() = 'admin') WITH CHECK (creator_id = auth.uid() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS "group_members_select_authenticated" ON public.group_members;
CREATE POLICY "group_members_select_authenticated" ON public.group_members FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "group_members_insert_self" ON public.group_members;
CREATE POLICY "group_members_insert_self" ON public.group_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "group_members_delete_self_or_admin" ON public.group_members;
CREATE POLICY "group_members_delete_self_or_admin" ON public.group_members FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS "group_messages_select_member" ON public.group_messages;
CREATE POLICY "group_messages_select_member" ON public.group_messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid()) OR public.get_my_role() = 'admin'
);
DROP POLICY IF EXISTS "group_messages_insert_member" ON public.group_messages;
CREATE POLICY "group_messages_insert_member" ON public.group_messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_description text DEFAULT NULL)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE created public.groups%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  INSERT INTO public.groups(name, description, creator_id)
  VALUES (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  RETURNING * INTO created;
  INSERT INTO public.group_members(group_id, user_id, role)
  VALUES (created.id, auth.uid(), 'owner')
  ON CONFLICT DO NOTHING;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group(p_group_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.group_members(group_id, user_id)
  VALUES (p_group_id, auth.uid())
  ON CONFLICT DO NOTHING;
$$;

CREATE TABLE IF NOT EXISTS public.project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'project-assets',
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_comments_select_authenticated" ON public.project_comments;
CREATE POLICY "project_comments_select_authenticated" ON public.project_comments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "project_comments_insert_authenticated" ON public.project_comments;
CREATE POLICY "project_comments_insert_authenticated" ON public.project_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "project_comments_delete_owner_or_admin" ON public.project_comments;
CREATE POLICY "project_comments_delete_owner_or_admin" ON public.project_comments FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS "project_assets_select_owner_or_admin" ON public.project_assets;
CREATE POLICY "project_assets_select_owner_or_admin" ON public.project_assets FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.user_id = auth.uid() OR public.get_my_role() = 'admin'))
);

CREATE OR REPLACE FUNCTION public.delete_project_secure(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  project_owner uuid;
BEGIN
  SELECT user_id INTO project_owner FROM public.projects WHERE id = p_project_id;
  IF project_owner IS NULL THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF project_owner <> auth.uid() AND public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only the project owner or an admin can delete this project.';
  END IF;

  DELETE FROM storage.objects o
  USING public.project_assets a
  WHERE a.project_id = p_project_id
    AND o.bucket_id = a.bucket_id
    AND o.name = a.storage_path;

  DELETE FROM public.project_assets WHERE project_id = p_project_id;
  DELETE FROM public.project_comments WHERE project_id = p_project_id;
  DELETE FROM public.projects WHERE id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_discoverable_projects(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, user_id uuid, title text, description text, tech_stack text[], project_type text,
  image_url text, demo_link text, github_link text, created_at timestamptz,
  builder_name text, builder_headline text, builder_location text, builder_age int,
  builder_availability text, builder_skills text[], builder_avatar text,
  builder_discoverable boolean, builder_featured boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.user_id, p.title, coalesce(p.description, ''), coalesce(p.tech_stack, '{}'),
    coalesce(p.project_type, 'Side Project'), p.image_url, p.demo_link, p.github_link, p.created_at,
    coalesce(u.display_name, u.full_name, u.username, 'Builder'), coalesce(sp.headline, ''),
    coalesce(sp.location, ''), sp.age, coalesce(sp.availability, ''), coalesce(sp.skills, '{}'),
    coalesce(u.avatar_url, sp.avatar_url), true, coalesce(sp.featured, false)
  FROM public.projects p
  JOIN public.users u ON u.id = p.user_id
  LEFT JOIN public.student_profiles sp ON sp.user_id = p.user_id
  WHERE p.visible = true AND coalesce(p.review_status, 'active') <> 'flagged'
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 24), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.list_creator_directory(
  p_limit integer DEFAULT 48,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_skills text[] DEFAULT NULL,
  p_availability text DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid, handle text, creator_name text, creator_headline text, creator_location text,
  creator_availability text, creator_avatar text, creator_discoverable boolean,
  creator_featured boolean, creator_review_status text, creator_visibility text,
  github_username text, skills text[], project_count integer, project_titles text[],
  primary_project_id uuid, primary_project_title text, primary_project_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH creator_rows AS (
    SELECT
      u.id AS user_id,
      coalesce(sp.handle, u.username) AS handle,
      coalesce(u.display_name, u.full_name, u.username, 'Creator') AS creator_name,
      coalesce(sp.headline, '') AS creator_headline,
      coalesce(sp.location, '') AS creator_location,
      coalesce(sp.availability, '') AS creator_availability,
      coalesce(u.avatar_url, sp.avatar_url, '') AS creator_avatar,
      true AS creator_discoverable,
      coalesce(sp.featured, false) AS creator_featured,
      coalesce(sp.review_status, 'approved') AS creator_review_status,
      'public'::text AS creator_visibility,
      coalesce(sp.github_username, '') AS github_username,
      coalesce(sp.skills, '{}'::text[]) AS skills,
      count(p.id)::integer AS project_count,
      coalesce(array_agg(p.title ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL), '{}'::text[]) AS project_titles
    FROM public.users u
    LEFT JOIN public.student_profiles sp ON sp.user_id = u.id
    LEFT JOIN public.projects p ON p.user_id = u.id AND p.visible = true AND coalesce(p.review_status, 'active') <> 'flagged'
    WHERE coalesce(u.suspended_until, now() - interval '1 second') <= now()
      AND (p_availability IS NULL OR p_availability = '' OR sp.availability = p_availability)
      AND (p_skills IS NULL OR coalesce(sp.skills, '{}'::text[]) && p_skills)
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR u.username ILIKE '%' || public.normalize_username(p_search) || '%'
        OR coalesce(u.display_name, u.full_name, '') ILIKE '%' || trim(p_search) || '%'
        OR u.id::text ILIKE '%' || trim(p_search) || '%'
        OR coalesce(sp.headline, '') ILIKE '%' || trim(p_search) || '%'
      )
    GROUP BY u.id, u.username, u.display_name, u.full_name, u.avatar_url, sp.handle, sp.headline, sp.location, sp.availability, sp.avatar_url, sp.featured, sp.review_status, sp.github_username, sp.skills
  )
  SELECT
    c.user_id, c.handle, c.creator_name, c.creator_headline, c.creator_location,
    c.creator_availability, c.creator_avatar, c.creator_discoverable, c.creator_featured,
    c.creator_review_status, c.creator_visibility, c.github_username, c.skills,
    c.project_count, c.project_titles, latest.id, latest.title, latest.project_type
  FROM creator_rows c
  LEFT JOIN LATERAL (
    SELECT p.id, p.title, p.project_type
    FROM public.projects p
    WHERE p.user_id = c.user_id AND p.visible = true AND coalesce(p.review_status, 'active') <> 'flagged'
    ORDER BY p.created_at DESC LIMIT 1
  ) latest ON true
  ORDER BY c.creator_featured DESC, c.creator_name ASC
  LIMIT least(greatest(coalesce(p_limit, 48), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_direct_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_creator_directory(integer, integer, text, text[], text) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
