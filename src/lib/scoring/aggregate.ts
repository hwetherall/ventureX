// ⚠ DEFERRED DRAFT (2026-05-19): this file belongs to a per-candidate
// scoring milestone that was planned but NOT shipped as M14. M14 shipped
// as the parameter builder (see parameter_builder.md). Retained because
// the scoring path is a viable future milestone and tests pass. See the
// banner in M14_SPRINT_PLAN.md for full context. Do not import this from
// production paths until a future milestone resumes the scoring work.

import {
  DIMENSION_KEYS,
  type CandidateDimensionScores,
  type Dimension,
} from "@/types/candidate-scoring";

// ────────────────────────────────────────────────────────────────────────
// Stage 4 aggregate score (PHASE3.md P3-D16, M14)
//
// Pure function lifted out of the orchestrator so it can be unit-tested in
// isolation (Section 3 D3 of /plan-eng-review, 2026-05-19). The orchestrator
// calls this for each candidate after Zod validation, then writes
// dimension_scores + aggregate_score in a single SQL UPDATE per P3-D21.
//
// Formula: aggregate = Σᵢ(scoreᵢ × weightᵢ) over the 7 dimensions.
// Since canonical weights sum to ≈1.0 (Stage 2 post-renormalization contract)
// and each Likert score ∈ [1, 5], the aggregate range is [1.0, 5.0].
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * Bounds on the weight sum that {@link computeAggregateScore} accepts before
 * throwing {@link WeightSumDriftError}. Matches Stage 2's renormalization
 * window (CLAUDE.md §11): the orchestrator scales any sum in [0.95, 1.05] to
 * 1.0 before persisting, so weights coming OUT of dimension_weights should
 * already sum to ≈1.0. The defensive check here catches a misuse (caller
 * passed unnormalized weights) without silently producing an out-of-range
 * aggregate.
 */
export const WEIGHT_SUM_FLOOR = 0.95;
export const WEIGHT_SUM_CEILING = 1.05;

// IEEE-754 tolerance for the boundary check. The actual concern is "did the
// caller pass grossly unnormalized weights that would corrupt the aggregate?"
// not "are the weights exactly at 0.95"; a 7-term accumulator over evenly
// divided floats routinely lands ~1e-16 outside the literal boundary, so a
// 1e-9 tolerance distinguishes float-roundoff from real drift without
// loosening the guard meaningfully.
const WEIGHT_SUM_EPSILON = 1e-9;

export class WeightSumDriftError extends Error {
  constructor(
    public readonly sum: number,
    public readonly floor: number = WEIGHT_SUM_FLOOR,
    public readonly ceiling: number = WEIGHT_SUM_CEILING,
  ) {
    super(
      `Weight sum (${sum.toFixed(4)}) outside accepted range [${floor}, ${ceiling}]. ` +
        `Stage 2 should have renormalized to ≈1.0; this likely indicates a caller bug.`,
    );
    this.name = "WeightSumDriftError";
  }
}

/**
 * @public
 * Per-dimension weights, one float per dimension. The orchestrator's
 * loadCanonicalWeights returns this shape after the latest-per-dimension
 * reduction over the dimension_weights table.
 */
export type DimensionWeights = Record<Dimension, number>;

/**
 * @public
 * Compute the weighted-aggregate score for one candidate.
 *
 * @throws {WeightSumDriftError} when the weight sum falls outside
 *   [WEIGHT_SUM_FLOOR, WEIGHT_SUM_CEILING]. The caller should treat this as
 *   a precondition violation (Stage 2 contract broken) and surface a
 *   diagnostic error, not retry.
 *
 * @example
 * // All cells = 3 (medium), uniform weights → aggregate = 3.0
 * computeAggregateScore(
 *   { product_solution: { score: 3, ... }, ... },
 *   { product_solution: 1/7, customers: 1/7, ... },
 * ); // → 3.0
 */
export function computeAggregateScore(
  scores: CandidateDimensionScores,
  weights: DimensionWeights,
): number {
  // Sum the weights once to validate the precondition before the multiply.
  let weightSum = 0;
  for (const dim of DIMENSION_KEYS) {
    weightSum += weights[dim];
  }
  if (
    weightSum < WEIGHT_SUM_FLOOR - WEIGHT_SUM_EPSILON ||
    weightSum > WEIGHT_SUM_CEILING + WEIGHT_SUM_EPSILON
  ) {
    throw new WeightSumDriftError(weightSum);
  }

  // Weighted sum. JS floating-point arithmetic: a 7-term sum of products
  // within [0, 5] introduces ~1e-15 relative error, well below the 2-decimal
  // resolution M15 displays. No rounding here — callers can format on read.
  let aggregate = 0;
  for (const dim of DIMENSION_KEYS) {
    aggregate += scores[dim].score * weights[dim];
  }
  return aggregate;
}
