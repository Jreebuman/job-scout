-- The search now runs in the "scout" edge function, not Claude. It locks a profile while searching.
alter table public.profiles add column if not exists search_started_at timestamptz;

-- New sign-ups are no longer queued for Claude; the site starts their first search directly.
create or replace function public.submit_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;
  insert into profiles (name, roles, skills, cv_text, locations, min_salary, contact, linkedin_url)
  values (
    left(trim(p->>'name'), 120), _clean_list(p->'roles'), _clean_list(p->'skills'),
    left(coalesce(p->>'cv_text', ''), 20000),
    left(coalesce(nullif(trim(p->>'locations'), ''), 'Amman, Jordan'), 200),
    nullif(p->>'min_salary', '')::integer, left(coalesce(p->>'contact', ''), 200),
    _clean_linkedin(p->>'linkedin_url')
  ) returning access_key into k;
  return k;
end $$;

create or replace function public.get_profile(k uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'roles', roles, 'skills', skills, 'cv_text', cv_text,
    'locations', locations, 'min_salary', min_salary, 'contact', contact, 'linkedin_url', linkedin_url,
    'searching', search_started_at is not null and search_started_at > now() - interval '4 minutes',
    'last_run_at', (select last_run_at from runs r where r.profile_id = p.id)
  ) from profiles p where access_key = k
$$;

update public.profiles set run_requested_at = null;
