-- =============================================================
-- TM7 on Supabase — run once in the SQL editor of the new project
-- =============================================================
-- The app keeps the same "path → content" layout it has in Vercel Blob:
--   docs   every JSON document (boards, ledger days, slips, jobs, …) — one row per path
--   files  an index of every binary file (passport pages, photos, PDFs); the bytes live in the
--          private Storage bucket "files" under the same path
-- Reading a month of ledger days is then one query instead of one request per day.
-- Only the server (secret key) touches these; row level security stays on with no policies.

create table if not exists public.docs (
  path        text primary key,
  body        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists docs_path_prefix on public.docs (path text_pattern_ops);
alter table public.docs enable row level security;

create table if not exists public.files (
  path          text primary key,
  size          bigint not null default 0,
  content_type  text not null default 'application/octet-stream',
  updated_at    timestamptz not null default now()
);
create index if not exists files_path_prefix on public.files (path text_pattern_ops);
alter table public.files enable row level security;

insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do nothing;
