-- Migration: 0006_parameters
-- Add the post-candidate Parameter Builder stage. The stage generates Tier 3
-- dynamic parameters, snapshots the merged Tier 1 + Tier 2 + Tier 3 schema,
-- and gates future cell research on that snapshot.

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
    'error'
  ));

CREATE TABLE parameter_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id uuid NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  profile_version_id uuid NOT NULL REFERENCES profile_versions(id) ON DELETE CASCADE,
  candidate_generation_run_id uuid NOT NULL,
  llm_call_id uuid REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  dynamic_parameters jsonb NOT NULL,
  full_parameter_schema jsonb NOT NULL,
  generation_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parameter_generation_runs_venture_idx
  ON parameter_generation_runs(venture_id, created_at DESC);

ALTER TABLE parameter_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parameter_generation_runs: own venture" ON parameter_generation_runs
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
