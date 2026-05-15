-- Migration: 0003_candidates
-- Phase 3 M12: candidate_companies table + status enum extension for
-- 'candidates_generating' and 'candidates_ready'. See PHASE3.md §3-§4.
--
-- This migration is independent of M14's eventual addition of
-- `dimension_scores jsonb` (migration 0004's job).

-- ────────────────────────────────────────────────────────────────────────
-- Extend ventures.status check constraint to cover the two new states
-- ────────────────────────────────────────────────────────────────────────
-- Postgres auto-names the check constraint when it's declared inline on the
-- column. The 0001 inline check became `ventures_status_check`. Drop + re-add
-- is the only way to extend an inline check; ALTER ... ADD VALUE is for
-- ENUM types, which we deliberately don't use here (text + check is more
-- forgiving for a schema in flux).

ALTER TABLE ventures DROP CONSTRAINT IF EXISTS ventures_status_check;
ALTER TABLE ventures ADD CONSTRAINT ventures_status_check
  CHECK (status IN (
    'intake',
    'extracting',
    'awaiting_refinement',
    'weighting',
    'ready',
    'candidates_generating',
    'candidates_ready',
    'error'
  ));

-- ────────────────────────────────────────────────────────────────────────
-- candidate_companies — one row per (generation_run, candidate)
-- ────────────────────────────────────────────────────────────────────────
-- generation_run_id groups the 10-60 candidates produced by a single Stage 3
-- call. The UI shows the latest generation_run_id's set; older runs stay as
-- audit trail (M13 will introduce additional runs when web-augmented and
-- LLM-only outputs coexist).

CREATE TABLE candidate_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id uuid NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  profile_version_id uuid NOT NULL REFERENCES profile_versions(id) ON DELETE CASCADE,
  generation_run_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL
    CHECK (type IN ('direct','category','same_problem_different_mechanism')),
  rationale text NOT NULL,
  -- Subset of the 7 dimension keys, stored as a text[] (Postgres array).
  -- The Zod schema constrains values to the DIMENSION_KEYS enum; the
  -- check constraint here is a defense-in-depth backstop.
  dimensions_implicated text[] NOT NULL
    CHECK (
      array_length(dimensions_implicated, 1) BETWEEN 1 AND 7
      AND dimensions_implicated <@ ARRAY[
        'product_solution',
        'customers',
        'transaction',
        'partners',
        'access',
        'geography_regulatory',
        'capital_asset'
      ]::text[]
    ),
  -- Trace any surprising candidate back to its LLM call (model, prompt, cost).
  -- ON DELETE SET NULL mirrors profile_versions.llm_call_id — losing the log
  -- shouldn't cascade-drop candidates.
  llm_call_id uuid REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX candidate_companies_venture_idx
  ON candidate_companies(venture_id, generation_run_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security — mirrors profile_versions / dimension_weights
-- ────────────────────────────────────────────────────────────────────────
-- Without this, any authenticated user could read any candidate set.
-- Non-negotiable per PHASE3.md §4.

ALTER TABLE candidate_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_companies: own venture" ON candidate_companies
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ventures v
      WHERE v.id = venture_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventures v
      WHERE v.id = venture_id AND v.created_by = auth.uid()
    )
  );
