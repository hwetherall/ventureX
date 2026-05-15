/**
 * Shared types for the eval framework.
 *
 * Cases are TypeScript modules (not JSON) so we get type-checking on the
 * shape and so case-specific overrides (e.g., model swaps) can be plain
 * code rather than schema additions. JSON would be marginally more
 * portable; we don't need portable yet.
 */

import type { CriterionResult } from "./criteria";

export interface EvalCase {
  /** Slug used as the CLI arg + the directory name. Lowercase + hyphens. */
  id: string;
  /** Human-readable name for log output. */
  name: string;
  /** Plain-text description the consultant would type into `/ventures/new`. */
  user_provided_description: string;
  /** Path (relative to repo root) to the directory containing PDF/DOCX docs. */
  documents_dir: string;
  /**
   * Optional path to a hand-curated expected profile JSON. Not used as
   * input to the eval; just a fixture for diffing during prompt iteration.
   */
  expected_profile_path?: string;
}

export interface StageResultSummary {
  criteriaResults: { id: string; description: string; result: CriterionResult }[];
  passing: number;
  total: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  attempts: number;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  stage1: StageResultSummary;
  stage2: StageResultSummary;
  totalCostUsd: number;
  totalLatencyMs: number;
  allPassing: boolean;
}
