# Job Scout

A public, no-login job-matching page for Jordan. Someone uploads their CV (or fills the form), and every evening a Claude scheduled task searches Bayt, LinkedIn and Akhtaboot's public pages, scores what it finds against their profile, and saves the matches. They come back to their private link to see them.

- **Site:** `index.html`, one static file on GitHub Pages. No build step.
- **Database:** its own Supabase project (`Job-Scout`, ref `niuobwrxfiojobswgvau`, eu-central-1). Schema in `schema.sql`.
- **Daily search:** the Claude scheduled task `job-scout-friend-search` (runs ~9:47 PM).

## How privacy works
- Each profile gets a random secret key. The person's private link is `…/#k=<key>`; the key sits after `#`, so it never reaches GitHub's servers.
- Visitors can't read or write tables directly. Row Level Security is on with no policies, and the public key can only call four functions: `submit_profile`, `update_profile`, `get_profile`, `get_matches`. Each only works with the right key.
- Only the publishable Supabase key is in `index.html` (safe to ship). The scheduled task writes matches through the Supabase Management API with a token kept outside this repo.

## CV upload
PDF (via pdf.js), Word .docx (via mammoth) and .txt are read in the visitor's browser. The text is used to pre-fill name, contact, roles and skills, then saved as text. The file itself is never uploaded.

## Adding more people
Anyone with the link can create their own profile. At the bottom of a profile, "Filling this in for someone else? Start a new profile" clears the saved key in that browser so you can enter another person.
