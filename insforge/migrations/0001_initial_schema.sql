-- Migration: 0001_initial_schema
-- VentureX Phases 0-2: ventures, documents, profile versions, weights, llm logs.
-- Includes eng review additions: critic_status (D3), run_id on llm logs (D4),
-- parse_error on documents.

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────
-- Tables (ordered so foreign keys resolve without ALTERs)
-- ────────────────────────────────────────────────────────────────────────

create table ventures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  user_provided_description text not null,
  codename text not null default 'VentureX',
  status text not null default 'intake'
    check (status in ('intake','extracting','awaiting_refinement','weighting','ready','error')),
  -- D3: critic outcome tracking. UI shows a yellow banner when 'unavailable'.
  critic_status text not null default 'pending'
    check (critic_status in ('pending','success','unavailable')),
  -- D4: identifies the current Stage 1 + critic + Stage 2 run for budget tracking.
  -- Reset (set to a new UUID) at the start of each run; re-runs after HITL
  -- get a fresh run_id and therefore a fresh $5 budget.
  current_run_id uuid,
  error_message text
);

create index ventures_created_by_idx on ventures(created_by, created_at desc);
create index ventures_status_idx on ventures(status) where status in ('extracting','weighting');

create table venture_documents (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  parsed_markdown text,
  parsed_at timestamptz,
  parse_error text,
  created_at timestamptz not null default now()
);

create index venture_documents_venture_id_idx on venture_documents(venture_id);

create table llm_call_logs (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid references ventures(id) on delete set null,
  run_id uuid,
  stage text not null,
  model_id text not null,
  prompt_text text not null,
  input_documents jsonb,
  response_text text,
  response_parsed jsonb,
  tokens_in int,
  tokens_out int,
  cost_usd numeric,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);

create index llm_call_logs_venture_id_idx on llm_call_logs(venture_id, created_at desc);
create index llm_call_logs_run_id_idx on llm_call_logs(run_id) where run_id is not null;

create table profile_versions (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  version_number int not null,
  source text not null
    check (source in ('llm_extracted','llm_critic','human_refined')),
  profile_json jsonb not null,
  llm_call_id uuid references llm_call_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (venture_id, version_number)
);

create index profile_versions_venture_id_idx on profile_versions(venture_id, version_number desc);

create table dimension_weights (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  profile_version_id uuid not null references profile_versions(id) on delete cascade,
  dimension text not null
    check (dimension in (
      'product_solution','customers','transaction','partners',
      'access','geography_regulatory','capital_asset')),
  weight numeric not null check (weight >= 0 and weight <= 1),
  rationale text,
  source text not null
    check (source in ('llm_proposed','human_adjusted')),
  created_at timestamptz not null default now()
);

create index dimension_weights_venture_id_idx on dimension_weights(venture_id, profile_version_id);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- All tables: users can only read/write rows tied to ventures they own.
-- ────────────────────────────────────────────────────────────────────────

alter table ventures enable row level security;
alter table venture_documents enable row level security;
alter table llm_call_logs enable row level security;
alter table profile_versions enable row level security;
alter table dimension_weights enable row level security;

create policy "ventures: own rows" on ventures
  for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "venture_documents: own venture" on venture_documents
  for all
  using (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  )
  with check (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  );

create policy "profile_versions: own venture" on profile_versions
  for all
  using (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  )
  with check (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  );

create policy "dimension_weights: own venture" on dimension_weights
  for all
  using (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  )
  with check (
    exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  );

-- llm_call_logs may have venture_id null (orphan logs from system-level calls).
-- For orphans, only the service role should be able to read; users see their own venture's logs.
create policy "llm_call_logs: own venture" on llm_call_logs
  for all
  using (
    venture_id is not null
    and exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  )
  with check (
    venture_id is not null
    and exists (select 1 from ventures v where v.id = venture_id and v.created_by = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────
-- Storage bucket — manual steps (NOT executed by this migration)
-- ────────────────────────────────────────────────────────────────────────
-- 1. Create the storage bucket `venture-documents` in the InsForge Dashboard
--    (Storage → New bucket → name=venture-documents, public=off).
-- 2. Apply migration 0002_storage_policies.sql to install the RLS policies.
--
-- InsForge's storage.objects schema differs from Supabase — it uses `bucket`
-- (not `bucket_id`), `key` (not `name`), `uploaded_by` for ownership tracking,
-- and `auth.jwt() ->> 'sub'` (not `auth.uid()`). The Supabase-style policy
-- that used to live here threw `column "bucket_id" does not exist` against
-- InsForge. See 0002 for the corrected version.
--
-- Storage path convention used by app code (src/lib/storage/upload.ts):
--   `<venture_id>/<timestamp>-<safe-filename>`
-- In V1, ownership is enforced by `uploaded_by` (set automatically by the
-- SDK/REST surface on upload), not by the folder name.
