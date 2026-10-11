-- Job Desk features: status tracking, notes, drafts, how to apply.
alter table public.matches add column if not exists status text not null default 'new'
  check (status in ('new','shortlist','applied','interview','offer','skipped','rejected'));
alter table public.matches add column if not exists notes jsonb not null default '[]'::jsonb;
alter table public.matches add column if not exists applied_at timestamptz;
alter table public.matches add column if not exists updated_at timestamptz;
alter table public.matches add column if not exists msg_en text not null default '';
alter table public.matches add column if not exists msg_ar text not null default '';
alter table public.matches add column if not exists cover text not null default '';
alter table public.matches add column if not exists how_to_apply text not null default '';

-- Change a job's status; adds a "Status: ..." note like Job Desk does.
create or replace function public.set_match_status(k uuid, mid text, s text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; label text;
begin
  label := case s when 'new' then 'To review' when 'shortlist' then 'Shortlist' when 'applied' then 'Applied'
    when 'interview' then 'Interview' when 'offer' then 'Offer' when 'skipped' then 'Closed' when 'rejected' then 'Closed' end;
  if label is null then raise exception 'unknown status'; end if;
  select id into pid from profiles where access_key = k;
  if pid is null then return null; end if;
  update matches set
    status = s,
    applied_at = case when s = 'applied' then now() else applied_at end,
    notes = case when jsonb_array_length(notes) >= 200 then notes
      else notes || jsonb_build_array(jsonb_build_object('at', now(), 'text', 'Status: ' || label)) end,
    updated_at = now()
  where profile_id = pid and id = mid;
  if not found then return null; end if;
  return (select to_jsonb(m) - 'profile_id' from matches m where profile_id = pid and id = mid);
end $$;

create or replace function public.add_match_note(k uuid, mid text, t text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if coalesce(trim(t), '') = '' then raise exception 'empty note'; end if;
  select id into pid from profiles where access_key = k;
  if pid is null then return null; end if;
  update matches set
    notes = case when jsonb_array_length(notes) >= 200 then notes
      else notes || jsonb_build_array(jsonb_build_object('at', now(), 'text', left(trim(t), 1000))) end,
    updated_at = now()
  where profile_id = pid and id = mid;
  if not found then return null; end if;
  return (select to_jsonb(m) - 'profile_id' from matches m where profile_id = pid and id = mid);
end $$;

revoke all on function public.set_match_status(uuid, text, text), public.add_match_note(uuid, text, text) from public;
grant execute on function public.set_match_status(uuid, text, text), public.add_match_note(uuid, text, text) to anon, authenticated;
