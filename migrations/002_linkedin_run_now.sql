-- LinkedIn profile link + "Run now" requests.
alter table public.profiles add column if not exists linkedin_url text not null default '';
alter table public.profiles add column if not exists run_requested_at timestamptz;

create or replace function public._clean_linkedin(v text) returns text
language sql immutable as $$
  select case when trim(coalesce(v,'')) ~* '^(https?://)?([a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$'
    then left(regexp_replace(trim(v), '^(https?://)?', 'https://'), 200) else '' end
$$;

create or replace function public.submit_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;
  insert into profiles (name, roles, skills, cv_text, locations, min_salary, contact, linkedin_url, run_requested_at)
  values (
    left(trim(p->>'name'), 120), _clean_list(p->'roles'), _clean_list(p->'skills'),
    left(coalesce(p->>'cv_text', ''), 20000),
    left(coalesce(nullif(trim(p->>'locations'), ''), 'Amman, Jordan'), 200),
    nullif(p->>'min_salary', '')::integer, left(coalesce(p->>'contact', ''), 200),
    _clean_linkedin(p->>'linkedin_url'), now()
  ) returning access_key into k;
  return k;
end $$;

create or replace function public.update_profile(k uuid, p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;
  update profiles set
    name = left(trim(p->>'name'), 120), roles = _clean_list(p->'roles'), skills = _clean_list(p->'skills'),
    cv_text = left(coalesce(p->>'cv_text', ''), 20000),
    locations = left(coalesce(nullif(trim(p->>'locations'), ''), 'Amman, Jordan'), 200),
    min_salary = nullif(p->>'min_salary', '')::integer, contact = left(coalesce(p->>'contact', ''), 200),
    linkedin_url = _clean_linkedin(p->>'linkedin_url'), updated_at = now()
  where access_key = k;
  return found;
end $$;

create or replace function public.get_profile(k uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'roles', roles, 'skills', skills, 'cv_text', cv_text,
    'locations', locations, 'min_salary', min_salary, 'contact', contact, 'linkedin_url', linkedin_url,
    'run_requested_at', run_requested_at,
    'last_run_at', (select last_run_at from runs r where r.profile_id = p.id)
  ) from profiles p where access_key = k
$$;

-- Queue an on-demand search. At most one request per 3 hours per person.
create or replace function public.request_run(k uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; req timestamptz; last timestamptz;
begin
  select p.id, p.run_requested_at, r.last_run_at into pid, req, last
  from profiles p left join runs r on r.profile_id = p.id where p.access_key = k;
  if pid is null then return jsonb_build_object('status', 'not_found'); end if;
  if req is not null then return jsonb_build_object('status', 'queued', 'requested_at', req); end if;
  if last is not null and last > now() - interval '3 hours' then
    return jsonb_build_object('status', 'too_soon', 'next_at', last + interval '3 hours');
  end if;
  update profiles set run_requested_at = now() where id = pid returning run_requested_at into req;
  return jsonb_build_object('status', 'queued', 'requested_at', req);
end $$;

revoke all on function public.request_run(uuid), public._clean_linkedin(text) from public;
grant execute on function public.request_run(uuid) to anon, authenticated;
