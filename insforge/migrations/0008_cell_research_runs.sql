-- Migration: 0008_cell_research_runs
-- Cell Research V2: isolated research runs, results, multi-source evidence,
-- and provider-call audit records. Canonical `cells` remain unchanged until
-- an explicit promotion action copies an accepted run into them.

CREATE TABLE cell_research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id uuid NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  pipeline_version text NOT NULL
    CHECK (pipeline_version IN ('v1_snapshot', 'v2_policy_routed')),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'running', 'completed', 'failed', 'cancelled')),
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  parameter_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  predicted_cost_usd numeric,
  actual_cost_usd numeric NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cell_research_runs_venture_idx
  ON cell_research_runs(venture_id, created_at DESC);

CREATE TABLE cell_research_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES cell_research_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidate_companies(id) ON DELETE CASCADE,
  parameter_key text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('universal', 'framework', 'dynamic')),
  value jsonb,
  proposed_confidence text NOT NULL
    CHECK (proposed_confidence IN ('verified', 'inferred', 'unknown')),
  final_confidence text NOT NULL
    CHECK (final_confidence IN ('verified', 'inferred', 'unknown')),
  reason text,
  verifier_outcome jsonb,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, candidate_id, parameter_key)
);

CREATE INDEX cell_research_results_run_idx
  ON cell_research_results(run_id, candidate_id);
CREATE INDEX cell_research_results_confidence_idx
  ON cell_research_results(run_id, final_confidence);

CREATE TABLE cell_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES cell_research_results(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_request_id text,
  url text NOT NULL,
  canonical_url text NOT NULL,
  title text NOT NULL DEFAULT '',
  source_domain text NOT NULL,
  source_class text NOT NULL,
  excerpt text NOT NULL,
  published_at timestamptz,
  effective_at text,
  retrieved_at timestamptz NOT NULL,
  search_query text,
  result_rank int,
  content_hash text,
  candidate_match boolean,
  disposition text NOT NULL
    CHECK (disposition IN ('direct', 'inferred', 'contradictory', 'rejected')),
  supported_value_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  verifier_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cell_evidence_result_idx ON cell_evidence(result_id);
CREATE INDEX cell_evidence_url_idx ON cell_evidence(canonical_url);

CREATE TABLE research_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES cell_research_runs(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidate_companies(id) ON DELETE SET NULL,
  parameter_key text,
  provider text NOT NULL,
  operation text NOT NULL,
  query text,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_count int,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_provider_calls_run_idx
  ON research_provider_calls(run_id, created_at);
CREATE INDEX research_provider_calls_cell_idx
  ON research_provider_calls(candidate_id, parameter_key, created_at);

-- RLS follows each run's venture ownership. Rows with no reachable owned run
-- are invisible to application clients.
ALTER TABLE cell_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cell_research_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE cell_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_provider_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cell_research_runs: own venture" ON cell_research_runs
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

CREATE POLICY "cell_research_results: own run" ON cell_research_results
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM cell_research_runs r
      JOIN ventures v ON v.id = r.venture_id
      WHERE r.id = run_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM cell_research_runs r
      JOIN ventures v ON v.id = r.venture_id
      WHERE r.id = run_id AND v.created_by = auth.uid()
    )
  );

CREATE POLICY "cell_evidence: own result" ON cell_evidence
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM cell_research_results cr
      JOIN cell_research_runs r ON r.id = cr.run_id
      JOIN ventures v ON v.id = r.venture_id
      WHERE cr.id = result_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM cell_research_results cr
      JOIN cell_research_runs r ON r.id = cr.run_id
      JOIN ventures v ON v.id = r.venture_id
      WHERE cr.id = result_id AND v.created_by = auth.uid()
    )
  );

CREATE POLICY "research_provider_calls: own run" ON research_provider_calls
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM cell_research_runs r
      JOIN ventures v ON v.id = r.venture_id
      WHERE r.id = run_id AND v.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM cell_research_runs r
      JOIN ventures v ON v.id = r.venture_id
      WHERE r.id = run_id AND v.created_by = auth.uid()
    )
  );

COMMENT ON TABLE cell_research_runs IS
  'Versioned cell-research experiments. V2 runs remain isolated until explicit promotion.';
COMMENT ON TABLE cell_evidence IS
  'Claim-level, multi-source evidence and verification disposition for one V2 result.';
COMMENT ON TABLE research_provider_calls IS
  'Secret-free provider audit trail used for bounded retries, cost, and latency analysis.';
