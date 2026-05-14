-- Migration: 0002_storage_policies
--
-- Storage RLS for the `venture-documents` bucket. Prerequisite: the bucket
-- itself must exist (create via InsForge Dashboard → Storage → New bucket →
-- name=venture-documents, public=off).
--
-- ────────────────────────────────────────────────────────────────────────
-- InsForge vs Supabase storage schema (gotchas)
-- ────────────────────────────────────────────────────────────────────────
-- InsForge's storage.objects table uses different columns than Supabase:
--   - `bucket` (not `bucket_id`)
--   - `key` (not `name`) — what storage.foldername() operates on
--   - `uploaded_by` (text, matches the JWT sub) for ownership
--   - auth context is `auth.jwt() ->> 'sub'` (text), not `auth.uid()` (uuid)
-- Per-operation policies are required (FOR SELECT / INSERT / UPDATE / DELETE
-- as separate CREATE POLICY blocks). Wrapping `auth.jwt() ->> 'sub'` in
-- `(SELECT ...)` is the performance hint from InsForge's RLS guide — it
-- evaluates once per query instead of once per row.
--
-- ────────────────────────────────────────────────────────────────────────
-- V1 pattern: owner-only (simplest sufficient for single-user mode)
-- ────────────────────────────────────────────────────────────────────────
-- Each storage object is readable / writable only by the user who uploaded
-- it. The InsForge SDK + REST surface set `uploaded_by` automatically on
-- upload, so application code does not pass it explicitly.
--
-- Trade-off vs the path-scoped pattern (join via ventures.created_by):
--   - V1: same effective behavior, no JOIN cost per RLS check
--   - Phase 4 team-sharing: needs to switch to a venture-JOIN pattern that
--     allows team members to access docs uploaded by other team members.
--     See insforge skill: storage/postgres-rls.md "Team-shared" pattern.
--
-- This migration is idempotent — DROP IF EXISTS prefixes make it safe to
-- re-apply if you change patterns later.

-- ────────────────────────────────────────────────────────────────────────
-- Clean slate
-- ────────────────────────────────────────────────────────────────────────
-- Drop any matching policies that may exist from prior auto-install or
-- attempted runs. The fresh-install case (no auto-defaults) just no-ops these.
DROP POLICY IF EXISTS storage_objects_venture_docs_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_venture_docs_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_venture_docs_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_venture_docs_delete ON storage.objects;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────
-- Owner-only on venture-documents
-- ────────────────────────────────────────────────────────────────────────

CREATE POLICY storage_objects_venture_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'venture-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY storage_objects_venture_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'venture-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY storage_objects_venture_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket = 'venture-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    bucket = 'venture-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY storage_objects_venture_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'venture-documents'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

-- ────────────────────────────────────────────────────────────────────────
-- Grants — required for RLS to permit the operations at all
-- ────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Verification query (run this after applying to confirm)
-- ────────────────────────────────────────────────────────────────────────
-- SELECT polname, polcmd,
--        pg_get_expr(polqual,      polrelid) AS using_clause,
--        pg_get_expr(polwithcheck, polrelid) AS check_clause
-- FROM pg_policy
-- WHERE polrelid = 'storage.objects'::regclass
--   AND polname LIKE 'storage_objects_venture_docs_%';
