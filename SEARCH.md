# Job Scout search procedure

Followed by the scheduled tasks "Job Scout — nightly search" and "Job Scout — run-now requests". The task prompt says which profiles to search; everything else is here.

Job Scout is a public website (https://jreebuman.github.io/job-scout/) where people with no account upload a CV or fill in a form. Profiles live in a Supabase database. For each profile in scope: search Jordan's public job sites, score what you find against that person, and save the matches. Each person sees their own matches through their private link.

## Database: only through these two scripts

- Read: `powershell -NoProfile -File "D:\Claude work\job-scout\tools\sb-query.ps1" -Sql "<SELECT ...>"` prints JSON.
- Save: `powershell -NoProfile -File "D:\Claude work\job-scout\tools\save-matches.ps1" -ProfileId <uuid> -JsonFile <path>` saves new matches for one person, skips ones already saved, records the run, and clears their "Run now" request. Prints `[{"saved":N}]`.

Use sb-query.ps1 for SELECT statements only. Never run INSERT/UPDATE/DELETE yourself. Never select, print or use the `access_key` column (it is each person's private link key).

## Step 1: Load the profiles in scope

`select id, name, roles, skills, left(cv_text, 6000) as cv_text, locations, min_salary, linkedin_url from public.profiles where <condition from the task prompt> order by created_at;`

If the result is `[]`, stop and end with the "nothing to do" line from the task prompt.

## Step 2: Load what's already saved

`select profile_id, id from public.matches where profile_id in (<ids from step 1>);` Keep these so you don't re-score jobs a person already has.

## Step 3: Learn about each person

Read their roles, skills and CV text. If they gave a `linkedin_url`, you may open it once in the browser for extra context (headline, experience). LinkedIn usually shows a sign-in wall to logged-out visitors; if it does, ignore the profile and move on. Never sign in to see it.

## Step 4: Search (public pages, no sign-in)

Use the built-in browser tools (mcp__Claude_Browser__*). For each person pick 2-3 search terms from their roles (plus a skill if useful). Merge overlapping terms across people so nothing is searched twice. Rotate terms between runs when someone has many roles.

- Bayt: https://www.bayt.com/en/jordan/jobs/<keyword-with-dashes>-jobs/
- LinkedIn public jobs: https://www.linkedin.com/jobs/search?keywords=<keyword>&location=Jordan
- Akhtaboot (small, ~60 Jordan jobs): https://www.akhtaboot.com/en/jobs/search?page=<1..3>&per_page=25&search%5Bcp_country_name%5D%5Bvals%5D%5B%5D=Jordan. The browser may already be signed in to an Akhtaboot account belonging to this computer's owner. Reading listings is fine; never change anything on that account, never apply, never sign in or out.

Read gently: 3-5 seconds between page loads, at most 3 result pages per term per site, about 20 opened job posts per site per run. Judge by title and company before opening a post. Skip expired postings and anything that asks applicants to pay a fee (a scam pattern); note fee scams in the summary.

## Step 5: Filter lightly, per person

Cast a wide net and let the score sort it. Only hard-skip for a person: expired/closed postings, jobs requiring relocation outside Jordan, or jobs that legally require a license or degree clearly unrelated to anything in that person's roles, skills, CV or LinkedIn (e.g. a medical license, an engineering degree). One job can be saved for several people.

## Step 6: Score 0-100, per person

| Part | Points | How |
|---|---|---|
| Role fit | 40 | Closeness to their target roles. Near-exact title = full; adjacent/related = partial. |
| Skills match | 30 | Overlap between the job's requirements and their skills, CV and LinkedIn. |
| Location | 15 | Amman or remote from Jordan = 15. Elsewhere in Jordan = 8, or 15 if their locations include that city. |
| Salary | 15 | Listed salary at or above their min_salary, no salary listed, or no minimum set = 15. About 25% under = 8. About 50% or more under = 0. |

Subtract 5-15 for requirements they clearly don't meet (a required degree, years far above theirs, a language they lack) and list them in gaps.

## Step 7: Save, one file per person

Write a JSON array per person to the scratchpad directory, objects with:
`id, title, company, location, work_type, salary, level, posted_at, url, source, summary, score, score_why, matched, gaps`

- id: `<source>-<site job id>` lowercase (e.g. `bayt-73668558`, `linkedin-4012345678`, `akhtaboot-167451`); if none is visible, a slug of company + title. Skip ids that person already has.
- company: the real company name when shown (the page builds a "Who do you know here?" LinkedIn link from it); "Confidential" when hidden.
- summary: shown as "What you'd be doing". 2-4 plain sentences in your own words, never copied, so the person knows what they're heading into: what the company is (one phrase), the day-to-day work, and the main must-haves (years, degree, languages, shift pattern). The first sentence also appears on the list row, so make it the day-to-day.
- work_type (on-site / hybrid / remote, plus shifts if stated), level and salary: fill them whenever the post says; leave empty rather than guess.
- score_why: one plain sentence. matched: 2-4 short phrases taken only from that person's own profile, CV or LinkedIn. gaps: short phrases.
- how_to_apply: if the post names a specific apply email, phone or form (rather than the site's own Apply button), copy it exactly. Otherwise leave empty.
- Drafts, only for jobs scoring 60 or more (leave the three fields empty below 60):
  - msg_en: about 80 words to the recruiter or hiring manager. Name the role, one or two real points from the person's CV that fit the job (with real numbers if their CV has them), and a simple ask (a short call, or to consider their application). Sign with their name as written in their profile.
  - msg_ar: the same message in natural, professional Arabic. Not word-for-word, not slang. Sign with their name.
  - cover: about 200 words. Opening that names the role and company, two short paragraphs mapping their CV to the job's requirements, a short close, signed with their name.
  - Use only facts from that person's profile, CV text and LinkedIn. Never claim a degree, certificate, tool or number they didn't state. Don't mention salary.
- Never invent facts about a person.

Run save-matches.ps1 for each person, including with a file containing `[]` for anyone with no new matches, so their "last checked" date updates and their Run-now request clears.

## Hard rules

Never sign in, sign out or create an account anywhere. Never click Apply, Easy Apply, Submit, Save, Follow, Connect or Message. Never type into a site's search box; build URLs instead. Never attempt a CAPTCHA or "verify you're human" page; stop on that site and note it. Never put a person's name, email or phone into a site's search box or URL. Never print anyone's CV text or contact details in your summary.

## Finish

A short summary for an unattended log: per source, jobs checked; per person (first name only), new matches saved and their top match title and score; anything skipped (fee scams, blocked sites).
