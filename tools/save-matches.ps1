# Saves scored matches for one profile, records the run and clears any pending "Run now" request.
# Skips ids already saved.
# Usage: powershell -File tools\save-matches.ps1 -ProfileId <uuid> -JsonFile <path>
# JsonFile: a JSON array of objects with keys id, title, company, location, work_type, salary,
# level, posted_at, url, source, summary, score (int), score_why, matched (array), gaps (array).
param([Parameter(Mandatory)][guid]$ProfileId, [Parameter(Mandatory)][string]$JsonFile)
$ErrorActionPreference = 'Stop'
$json = [IO.File]::ReadAllText((Resolve-Path $JsonFile))
$null = $json | ConvertFrom-Json
if ($json.Contains('$js$')) { throw 'JSON may not contain the text $js$' }
$sql = @"
with ins as (
  insert into public.matches (profile_id, id, title, company, location, work_type, salary, level,
    posted_at, url, source, summary, score, score_why, matched, gaps)
  select '$ProfileId'::uuid, r.id, r.title, coalesce(r.company,''), coalesce(r.location,''),
    coalesce(r.work_type,''), coalesce(r.salary,''), coalesce(r.level,''), coalesce(r.posted_at,''),
    coalesce(r.url,''), coalesce(r.source,''), coalesce(r.summary,''), coalesce(r.score,0),
    coalesce(r.score_why,''), coalesce(r.matched,'{}'), coalesce(r.gaps,'{}')
  from jsonb_to_recordset(`$js`$$json`$js`$::jsonb) as r(id text, title text, company text, location text,
    work_type text, salary text, level text, posted_at text, url text, source text, summary text,
    score int, score_why text, matched text[], gaps text[])
  where r.id is not null and r.title is not null
  on conflict (profile_id, id) do nothing
  returning id
), run as (
  insert into public.runs (profile_id, last_run_at, matches_found)
  values ('$ProfileId'::uuid, now(), (select count(*) from ins))
  on conflict (profile_id) do update set last_run_at = excluded.last_run_at, matches_found = excluded.matches_found
), clr as (
  update public.profiles set run_requested_at = null where id = '$ProfileId'::uuid
)
select count(*) as saved from ins;
"@
& (Join-Path $PSScriptRoot 'sb-query.ps1') -Sql $sql
