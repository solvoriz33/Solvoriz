create or replace function public.list_creator_directory(p_limit integer default 48, p_offset integer default 0)
returns table (
  user_id uuid,
  handle text,
  creator_name text,
  creator_headline text,
  creator_location text,
  creator_availability text,
  creator_avatar text,
  creator_discoverable boolean,
  creator_featured boolean,
  creator_review_status text,
  creator_visibility text,
  github_username text,
  skills text[],
  project_count integer,
  project_titles text[],
  primary_project_id uuid,
  primary_project_title text,
  primary_project_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with creator_rows as (
    select
      sp.user_id,
      sp.handle,
      coalesce(u.full_name, 'Creator') as creator_name,
      coalesce(sp.headline, '') as creator_headline,
      coalesce(sp.location, '') as creator_location,
      coalesce(sp.availability, '') as creator_availability,
      coalesce(sp.avatar_url, '') as creator_avatar,
      coalesce(sp.discoverable, false) as creator_discoverable,
      coalesce(sp.featured, false) as creator_featured,
      coalesce(sp.review_status, 'pending') as creator_review_status,
      coalesce(sp.visibility, 'public') as creator_visibility,
      coalesce(sp.github_username, '') as github_username,
      coalesce(sp.skills, '{}'::text[]) as skills,
      count(p.id)::integer as project_count,
      coalesce(
        array_agg(p.title order by p.created_at desc) filter (where p.id is not null),
        '{}'::text[]
      ) as project_titles
    from public.student_profiles sp
    join public.users u on u.id = sp.user_id
    left join public.projects p
      on p.user_id = sp.user_id
     and p.visible = true
     and coalesce(p.review_status, 'active') <> 'flagged'
    where coalesce(sp.visibility, 'public') = 'public'
      and coalesce(sp.review_status, 'pending') <> 'flagged'
    group by
      sp.user_id, sp.handle, u.full_name, sp.headline, sp.location, sp.availability,
      sp.avatar_url, sp.discoverable, sp.featured, sp.review_status, sp.visibility,
      sp.github_username, sp.skills
  )
  select
    c.user_id,
    c.handle,
    c.creator_name,
    c.creator_headline,
    c.creator_location,
    c.creator_availability,
    c.creator_avatar,
    c.creator_discoverable,
    c.creator_featured,
    c.creator_review_status,
    c.creator_visibility,
    c.github_username,
    c.skills,
    c.project_count,
    c.project_titles,
    latest.id as primary_project_id,
    latest.title as primary_project_title,
    latest.project_type as primary_project_type
  from creator_rows c
  left join lateral (
    select p.id, p.title, p.project_type
    from public.projects p
    where p.user_id = c.user_id
      and p.visible = true
      and coalesce(p.review_status, 'active') <> 'flagged'
    order by p.created_at desc
    limit 1
  ) latest on true
  order by c.creator_featured desc, c.project_count desc, c.creator_name asc
  limit least(greatest(coalesce(p_limit, 48), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.list_creator_directory(integer, integer) to authenticated;
