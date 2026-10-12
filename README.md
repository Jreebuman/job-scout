# Job Scout

A public, no-login job-matching site for Jordan. People upload a CV (or fill the form), and Job Scout searches LinkedIn and Akhtaboot, scores what it finds against their profile, and saves ranked matches with a "what you'd be doing" summary, gaps, and starter drafts in English and Arabic. Everything runs on free services; no Claude and no PC involved.

- **Site:** `index.html`, one static file on GitHub Pages. Works in any phone browser and installs to the home screen.
- **Database:** its own Supabase project (`Job-Scout`, ref `niuobwrxfiojobswgvau`). Schema in `schema.sql` plus `migrations/`.
- **Search engine:** `supabase/functions/scout/index.ts`, a Supabase edge function.
  - **Run now** on the site calls it directly; a search takes about a minute. At most once every 3 hours per person.
  - **Nightly:** a `pg_cron` job (`job-scout-nightly`, every 6 minutes from 18:00 to 21:54 UTC, i.e. 9 PM to 1 AM Jordan time) calls it with a secret header; each call searches for the one person who has waited longest (20+ hours). That covers up to 40 people a night.

## Sources
- **LinkedIn** public job search (Jordan only, last 30 days), with full descriptions for the best title matches.
- **Akhtaboot** Jordan listings.
- **Bayt and Tanqeeb block automated access** (Bayt returns 403; Tanqeeb serves an AWS bot-check). Job Scout does not try to get around these.

## Scoring (no AI)
Role fit (40) from title similarity to the person's target roles, with synonyms (team lead / supervisor, customer care / contact center, and so on) and level checks. Skills (30), 5 points per skill found in the post. Location (15). Salary (15) against their minimum. Penalties and gaps for: degree required, years of experience above theirs, languages they don't list, car/licence, technical software-testing roles, and specialist fields (pharma/clinical/lab, engineering, accounting certifications). Jobs requiring a license clearly outside their profile, or located outside Jordan, are skipped. Drafts are templates for jobs scoring 60+.

## Privacy
- Each profile has a random secret key; the person's private link is `…/#k=<key>`. Visitors can only call `submit_profile`, `update_profile`, `get_profile`, `get_matches`, `set_match_status`, `add_match_note`; each needs the right key. Row Level Security blocks direct table access.
- Only the publishable Supabase key is in `index.html`. The engine uses the service key server-side; the nightly secret and admin token live in `.secrets/` (not in git).

## Admin
`tools/sb-query.ps1 -Sql "..."` runs SQL through the Supabase Management API. To redeploy the engine:
`supabase functions deploy scout --project-ref niuobwrxfiojobswgvau --use-api --no-verify-jwt`
