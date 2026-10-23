-- 005: "Forgot my link?" requests, so the send-link function can limit how often it emails.
-- Only the function (service key) touches this table; visitors can't read or write it.
create table if not exists public.link_requests (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now()
);
create index if not exists link_requests_email_at on public.link_requests (email, at);
alter table public.link_requests enable row level security;
