-- Migration: 0004_candidate_citations
-- Phase 3 M13: add `citations` jsonb to candidate_companies so each candidate
-- can carry up to 3 citation entries linking back to the web-search hit that
-- grounded it. See PHASE3.md §6b.
--
-- Per P3-D11 (citations stored as jsonb on the candidate row, not a separate
-- candidate_citations table): atomic with the candidate row, simple to read,
-- scales fine at our row counts. If a future milestone needs citation-source
-- analytics (e.g., "rank sources by reuse"), lift to a table then.

-- ────────────────────────────────────────────────────────────────────────
-- Add the column — nullable. M12-era rows have no web evidence backing them
-- and stay NULL. M13 candidates get either a non-empty array (web-evidenced)
-- or NULL (training-data-only).
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE candidate_companies
  ADD COLUMN citations jsonb;

COMMENT ON COLUMN candidate_companies.citations IS
  'Per-candidate web evidence citations. NULL when the candidate came from
   training data only. Non-null is an array of 0-3 objects, each with shape
   { url: string, title: string, query: string } where `query` is the
   strategic_risks_and_uncertainties[].implies_search_for string whose Exa
   search surfaced the hit. Shape is enforced by CandidateCompanySchema at
   insert; no CHECK constraint here per PHASE3.md P3-D11.';
