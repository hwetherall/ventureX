-- Migration: 0007_cells
-- M15 Cell Research: per-(candidate, parameter) facts, plus Exa search audit
-- log. See M15_DESIGN.md and M15_SPRINT_PLAN.md.
--
-- One row per cell in the X × Y matrix: for a venture with N candidates and
-- M parameters there will be N × M cell rows. V1 ships single-candidate
-- (Schneider Electric) to validate the pipeline; the schema is unchanged
-- when M15.1 introduces parallel multi-candidate.

-- ────────────────────────────────────────────────────────────────────────
-- Extend ventures.status check to cover the two new states
-- ────────────────────────────────────────────────────────────────────────
-- See 0003_candidates / 0005_dimension_scores / 0006_parameters for the
-- inline-check drop-and-recreate pattern.

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
    'scoring',
    'scored',
    'parameters_generating',
    'parameters_ready',
    'cells_researching',
    'cells_ready',
    'error'
  ));

-- ────────────────────────────────────────────────────────────────────────
-- cells — one row per (candidate, parameter)
-- ────────────────────────────────────────────────────────────────────────
-- `parameter_key` is a text reference into
-- `parameter_generation_runs.full_parameter_schema[i].id`. We deliberately
-- do NOT add a FK to that jsonb element — Postgres can't FK into jsonb and
-- the parameter schema is versioned per run, not per row. The orchestrator
-- enforces the linkage at write time.
--
-- `tier` enum mirrors `ParameterTierSchema` exactly so a cell knows which
-- prompt produced it without joining back to the schema. This denormalisation
-- is intentional: dossier reads + Innovera export filter by tier and we
-- don't want a jsonb lookup per cell.

CREATE TABLE cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate_companies(id) ON DELETE CASCADE,
  parameter_key text NOT NULL,
  tier text NOT NULL
    CHECK (tier IN ('universal','framework','dynamic')),
  -- Value shape varies by parameter (`value_type` on the schema entry).
  -- Zod validates per-tier outputs at insert time. NULL is allowed when
  -- confidence='unknown' and we explicitly couldn't ground the cell.
  value jsonb,
  -- Citation shape: { url: string, title: string, snippet: string, retrieved_at: string }
  -- Nullable: T1 cells are training-data-only by design (M15_DESIGN.md
  -- §Success Criteria #1); T3 cells with confidence='unknown' have no
  -- citation. T2 cells should always carry a citation echoed from M13.
  citation jsonb,
  confidence text NOT NULL
    CHECK (confidence IN ('verified','inferred','unknown')),
  -- Free-text reason when the cell is unusual: e.g. 'no_evidence_found' for
  -- T3 cells that returned empty Exa even after a broadening retry.
  reason text,
  llm_call_id uuid REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Latest-write-wins per cell. M15.1 may add cell_research_runs as audit
  -- trail; V1 keeps it simple and lets re-research overwrite via UPSERT.
  UNIQUE (candidate_id, parameter_key)
);

-- Per-tier resume + per-confidence verification UI both benefit from these:
CREATE INDEX cells_candidate_tier_idx ON cells(candidate_id, tier);
CREATE INDEX cells_candidate_confidence_idx ON cells(candidate_id, confidence);

-- ────────────────────────────────────────────────────────────────────────
-- exa_call_logs — Tier 3 web search audit trail
-- ────────────────────────────────────────────────────────────────────────
-- Mirrors llm_call_logs in spirit: one row per Exa neural search, including
-- the broadened retry attempts. Lets us audit cost-per-cell and identify
-- queries that always return empty (signal that a parameter's prompt_hint
-- needs work).

CREATE TABLE exa_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id uuid REFERENCES ventures(id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES candidate_companies(id) ON DELETE SET NULL,
  -- The parameter this search was trying to ground. Mirrors cells.parameter_key.
  parameter_key text,
  -- 'stage_5_t3_initial' for the first attempt, 'stage_5_t3_broadened' for
  -- the retry-with-dropped-keyword fallback (M15_DESIGN.md §Tier 3 fallback).
  stage text NOT NULL,
  query text NOT NULL,
  num_results int,
  -- Full results array (url, title, snippet) so we can later replay extraction
  -- on better prompts without re-paying Exa.
  results jsonb,
  cost_usd numeric,
  latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exa_call_logs_venture_idx
  ON exa_call_logs(venture_id, created_at DESC);
CREATE INDEX exa_call_logs_candidate_idx
  ON exa_call_logs(candidate_id, parameter_key);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────
-- cells RLS inherits through the candidate → venture join, same shape as
-- candidate_companies and parameter_generation_runs. Non-negotiable.

ALTER TABLE cells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cells: own venture" ON cells
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM candidate_companies cc
      JOIN ventures v ON v.id = cc.venture_id
      WHERE cc.id = candidate_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM candidate_companies cc
      JOIN ventures v ON v.id = cc.venture_id
      WHERE cc.id = candidate_id AND v.created_by = auth.uid()
    )
  );

ALTER TABLE exa_call_logs ENABLE ROW LEVEL SECURITY;

-- exa_call_logs: scoped by venture_id where set (matches llm_call_logs RLS
-- pattern). Rows with NULL venture_id are administrative — never readable
-- by application clients.
CREATE POLICY "exa_call_logs: own venture" ON exa_call_logs
  FOR ALL
  USING (
    venture_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM ventures v
      WHERE v.id = venture_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    venture_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM ventures v
      WHERE v.id = venture_id AND v.created_by = auth.uid()
    )
  );
