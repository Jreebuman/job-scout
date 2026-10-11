-- Job Scout schema. Run once in the Supabase SQL editor (or via the Management API).
-- Visitors never touch tables directly: RLS is on with no policies, and the anon role
-- only gets EXECUTE on the functions below. Each profile is reached by its secret access_key.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  access_key uuid not null unique default gen_random_uuid(),
  name text not null,
  roles text[] not null default '{}',
  skills text[] not null default '{}',
  cv_text text not null default '',
  locations text not null default 'Amman, Jordan',
  min_salary integer,
  contact text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  id text not null,
  title text not null,
  company text not null default '',
  location text not null default '',
  work_type text not null default '',
  salary text not null default '',
  level text not null default '',
  posted_at text not null default '',
  url text not null default '',
  source text not null default '',
  summary text not null default '',
  score integer not null default 0,
  score_why text not null default '',
  matched text[] not null default '{}',
  gaps text[] not null default '{}',
  found_at timestamptz not null default now(),
  primary key (profile_id, id)
);

create table if not exists public.runs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_run_at timestamptz not null,
  matches_found integer not null default 0
);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.runs enable row level security;
revoke all on public.profiles, public.matches, public.runs from anon, authenticated;

create or replace function public._clean_list(v jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(left(trim(x), 80)) filter (where trim(x) <> ''), '{}')
  from (select jsonb_array_elements_text(coalesce(v, '[]'::jsonb)) as x limit 20) s
$$;

create or replace function public.submit_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;
  insert into profiles (name, roles, skills, cv_text, locations, min_salary, contact)
  values (
    left(trim(p->>'name'), 120),
    _clean_list(p->'roles'),
    _clean_list(p->'skills'),
    left(coalesce(p->>'cv_text', ''), 20000),
    left(coalesce(nullif(trim(p->>'locations'), ''), 'Amman, Jordan'), 200),
    nullif(p->>'min_salary', '')::integer,
    left(coalesce(p->>'contact', ''), 200)
  ) returning access_key into k;
  return k;
end $$;

create or replace function public.update_profile(k uuid, p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name required'; end if;
  update profiles set
    name = left(trim(p->>'name'), 120),
    roles = _clean_list(p->'roles'),
    skills = _clean_list(p->'skills'),
    cv_text = left(coalesce(p->>'cv_text', ''), 20000),
    locations = left(coalesce(nullif(trim(p->>'locations'), ''), 'Amman, Jordan'), 200),
    min_salary = nullif(p->>'min_salary', '')::integer,
    contact = left(coalesce(p->>'contact', ''), 200),
    updated_at = now()
  where access_key = k;
  return found;
end $$;

create or replace function public.get_profile(k uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'roles', roles, 'skills', skills, 'cv_text', cv_text,
    'locations', locations, 'min_salary', min_salary, 'contact', contact,
    'last_run_at', (select last_run_at from runs r where r.profile_id = p.id)
  ) from profiles p where access_key = k
$$;

create or replace function public.get_matches(k uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(m) - 'profile_id' order by m.score desc, m.found_at desc), '[]'::jsonb)
  from matches m join profiles p on p.id = m.profile_id
  where p.access_key = k
$$;

revoke all on function public.submit_profile(jsonb), public.update_profile(uuid, jsonb),
  public.get_profile(uuid), public.get_matches(uuid), public._clean_list(jsonb) from public;
grant execute on function public.submit_profile(jsonb), public.update_profile(uuid, jsonb),
  public.get_profile(uuid), public.get_matches(uuid) to anon, authenticated;
