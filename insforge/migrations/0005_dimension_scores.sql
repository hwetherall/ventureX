-- Migration: 0005_dimension_scores
-- Phase 3 M14: per-candidate × per-dimension Likert scoring + weighted
-- aggregate ranking. See PHASE3.md §2 (M14 row), P3-D14 through P3-D21,
-- and M14_SPRINT_PLAN.md for the full sprint context.
--
-- This migration adds three things to candidate_companies and extends the
-- ventures.status check constraint to cover the two new Stage 4 states.
--
-- Per P3-D18: aggregate_score lives as a separate `numeric` column (not
-- embedded in dimension_scores jsonb) so M15's sort path is a single index
-- scan, not a sequential scan with a jsonb path expression.
--
-- Per P3-D20: the index is composite `(venture_id, generation_run_id,
-- aggregate_score DESC NULLS LAST)` because M15's actual query filters
-- by generation_run_id (latest set only; older runs are audit trail per
-- PHASE3.md §4) and orders by aggregate_score DESC. NULLS LAST ensures
-- unscored rows (M12/M13 candidates pre-M14, or rows from a venture
-- mid-scoring) sort to the bottom rather than the top.

-- ────────────────────────────────────────────────────────────────────────
-- Extend ventures.status check constraint to cover Stage 4 lifecycle
-- ────────────────────────────────────────────────────────────────────────
-- Same drop + re-add pattern as 0003. The 0003 constraint already covered
-- intake / extracting / awaiting_refinement / weighting / ready /
-- candidates_generating / candidates_ready / error; 0005 adds the two
-- Stage 4 states.

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
    'error'
  ));

-- ────────────────────────────────────────────────────────────────────────
-- candidate_companies.dimension_scores — per-cell Likert 1-5 + metadata
-- ────────────────────────────────────────────────────────────────────────
-- Nullable: pre-M14 rows (M12/M13 candidates) stay NULL until a Stage 4
-- run fills them. Shape is enforced by Stage4ScoringOutputSchema at insert;
-- no CHECK constraint here per the P3-D11 precedent for citations.
--
-- Expected shape per row (Zod-enforced):
--   {
--     product_solution:       { score: 1-5, rationale: text, confidence: 0-1 },
--     customers:              { score: 1-5, rationale: text, confidence: 0-1 },
--     transaction:            { score: 1-5, rationale: text, confidence: 0-1 },
--     partners:               { score: 1-5, rationale: text, confidence: 0-1 },
--     access:                 { score: 1-5, rationale: text, confidence: 0-1 },
--     geography_regulatory:   { score: 1-5, rationale: text, confidence: 0-1 },
--     capital_asset:          { score: 1-5, rationale: text, confidence: 0-1 }
--   }
--
-- All 7 keys required (P3-D19 strict coverage). Zod refinement enforces
-- length match; this column is the persistence layer only.

ALTER TABLE candidate_companies
  ADD COLUMN dimension_scores jsonb;

COMMENT ON COLUMN candidate_companies.dimension_scores IS
  'Per-dimension Likert 1-5 scores (P3-D15) with single-sentence rationale
   and confidence (0-1). All 7 dimension keys required per P3-D19 strict
   Zod refinement. NULL on M12/M13 candidates that predate Stage 4. Shape
   enforced by Stage4ScoringOutputSchema; no CHECK constraint per P3-D11
   precedent.';

-- ────────────────────────────────────────────────────────────────────────
-- candidate_companies.aggregate_score — weighted sum for M15 sort
-- ────────────────────────────────────────────────────────────────────────
-- Per P3-D16: aggregate = Σᵢ(scoreᵢ × weightᵢ). Since dimension weights
-- sum to ≈1.0 and scores are 1-5, the aggregate range is [1.0, 5.0].
-- Computed in the orchestrator (src/lib/scoring/aggregate.ts, M14-T2)
-- after Zod validation, before the batch UPDATE.
--
-- CHECK constraint is defense-in-depth: Zod validates scores and the
-- helper computes aggregate, so the constraint should never fire — but
-- if the orchestrator is bypassed (manual SQL UPDATE during debugging,
-- external tooling), the column won't accept garbage.

ALTER TABLE candidate_companies
  ADD COLUMN aggregate_score numeric;

ALTER TABLE candidate_companies ADD CONSTRAINT candidate_companies_aggregate_range_check
  CHECK (
    aggregate_score IS NULL
    OR (aggregate_score >= 1.0 AND aggregate_score <= 5.0)
  );

COMMENT ON COLUMN candidate_companies.aggregate_score IS
  'Σᵢ(scoreᵢ × weightᵢ) computed at Stage 4 insert time per P3-D16. Range
   [1.0, 5.0]. Separate column (not jsonb path) per P3-D18 so M15 sort is
   indexed. NULL on pre-M14 candidates. CHECK constraint is defensive only;
   the value is computed in src/lib/scoring/aggregate.ts.';

-- ────────────────────────────────────────────────────────────────────────
-- Composite index for M15 read path (P3-D20)
-- ────────────────────────────────────────────────────────────────────────
-- M15 reads: "for venture X, latest generation_run_id, ordered by
-- aggregate_score DESC". The composite index covers all three predicates
-- in one scan. NULLS LAST keeps unscored candidates from polluting the
-- top of the sort.

CREATE INDEX candidate_companies_scored_idx
  ON candidate_companies(venture_id, generation_run_id, aggregate_score DESC NULLS LAST);
