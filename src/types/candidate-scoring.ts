// Stage 6 candidate scoring schemas. Originally drafted 2026-05-19 for a
// pre-research scoring milestone (deferred M14b, P3-D14 through P3-D21);
// resumed 2026-07 as Stage 6, which scores AFTER cell research so the
// ranking reflects researched facts rather than brainstorm-stage guesses.
// The per-cell shape and the batch schemas below are unchanged from the
// draft; Stage6CandidateScoringOutputSchema is the production per-candidate
// call shape.

import { z } from "zod";

import { DIMENSION_KEYS, type Dimension } from "./venture-profile";

// ────────────────────────────────────────────────────────────────────────
// Stage 4 Candidate Scoring output (PHASE3.md §2, §10, M14)
//
// The model returns one scored entry per input candidate. Each entry carries
// a per-dimension Likert score (1-5) with a single-sentence rationale and a
// confidence value (0-1). The orchestrator computes a weighted aggregate
// (see src/lib/scoring/aggregate.ts, P3-D16) and persists both the per-cell
// detail (dimension_scores jsonb) and the aggregate (aggregate_score numeric)
// to candidate_companies via migration 0005.
//
// P3-D14: single Opus call covering all candidates × all dimensions.
// P3-D15: Likert 1-5 with rationale + confidence per cell.
// P3-D16: aggregate = Σᵢ(scoreᵢ × weightᵢ).
// P3-D17: prompt input = profile + weights + candidate name + rationale + citations.
// P3-D19: strict refinement — output.scores.length === input.candidates.length
//         AND every input name appears in output (case-folded). Enforced by
//         the factory schema below; the base shape schema is used for plain
//         shape-validation contexts (round-trip tests, deserialization).
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * One (candidate, dimension) score cell. Bounds rationale:
 *
 *   - `score`: integer 1-5 Likert. 5 = perfect competitive overlap on this
 *     dimension; 1 = no meaningful overlap. Likert specifically (not float)
 *     so the model commits to a discrete judgment.
 *   - `rationale`: 1-400 chars (~2 sentences). Tighter cap than candidate
 *     rationale (800) because Stage 4 emits 7 rationales per candidate; the
 *     output budget compounds across 53 candidates × 7 dims = 371 cells.
 *   - `confidence`: 0-1 float. 1 = strong signal in the venture profile
 *     supports this score; 0 = the model is guessing.
 */
export const DimensionScoreCellSchema = z.object({
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

/**
 * @public
 * The 7-dimension score block for one candidate. All 7 keys required; missing
 * a key here is a coverage gap that §6c criterion 1 rejects. The orchestrator
 * uses this shape with the canonical weights set to compute aggregate_score.
 */
export const CandidateDimensionScoresSchema = z.object({
  product_solution: DimensionScoreCellSchema,
  customers: DimensionScoreCellSchema,
  transaction: DimensionScoreCellSchema,
  partners: DimensionScoreCellSchema,
  access: DimensionScoreCellSchema,
  geography_regulatory: DimensionScoreCellSchema,
  capital_asset: DimensionScoreCellSchema,
});

/**
 * @public
 * One scored candidate. `name` is the case-folded match key against the input
 * candidate set (see makeStrictStage4ScoringOutputSchema below). Bounds match
 * CandidateCompanySchema.name from candidate.ts.
 */
export const CandidateScoreSchema = z.object({
  name: z.string().min(1).max(200),
  dimension_scores: CandidateDimensionScoresSchema,
});

/**
 * @public
 * Shape-only Stage 4 output. Validates that every entry has the right shape
 * but does NOT enforce that the entry set matches the input candidates.
 * Cross-validation lives in makeStrictStage4ScoringOutputSchema below.
 *
 * Bounds:
 *   - `scores`: 10-60 entries. Same range as Stage3CandidatesOutputSchema
 *     because the input set is the M13 output; one entry per input candidate.
 *   - `synthesis_notes`: optional ≤800 chars. Cross-candidate observations
 *     the model wants to flag (e.g., "all SPDM candidates scored low on
 *     access because their channels bypass the venture's distribution
 *     entirely"). Not persisted per the §8 metadata-not-data policy.
 */
export const Stage4ScoringOutputSchema = z.object({
  scores: z.array(CandidateScoreSchema).min(10).max(60),
  synthesis_notes: z.string().max(800).optional(),
});

/**
 * @public
 * P3-D19 strict factory: returns a schema that adds cross-validation against
 * the input candidate set. The orchestrator calls this with the names from
 * the M13 candidate_companies rows it loaded; the resulting schema rejects
 * any output where:
 *
 *   - `scores.length` differs from `expectedCandidateNames.length`, OR
 *   - any input name (case-folded, trimmed) is missing from `scores`, OR
 *   - any output name (case-folded, trimmed) duplicates another.
 *
 * Why a factory instead of a parameterless refinement: Zod refinements don't
 * have access to external state at parse time, and the strict check is
 * inherently cross-input. Factory closure over expectedCandidateNames keeps
 * the strict logic inside the schema layer (single source of truth) while
 * letting the orchestrator supply the comparand at call time.
 *
 * The base Stage4ScoringOutputSchema remains exported for shape-only contexts
 * (round-trip tests, deserialization of already-validated stored data).
 */
export function makeStrictStage4ScoringOutputSchema(
  expectedCandidateNames: string[],
) {
  const expectedKeys = new Set(
    expectedCandidateNames.map((n) => n.toLowerCase().trim()),
  );

  return Stage4ScoringOutputSchema.superRefine((data, ctx) => {
    // 1. Length match
    if (data.scores.length !== expectedCandidateNames.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scores.length (${data.scores.length}) must equal input candidate count (${expectedCandidateNames.length})`,
        path: ["scores"],
      });
      // Don't bail — the user wants to see all problems at once.
    }

    // 2. Every input name covered (case-folded)
    const outputKeys = new Set<string>();
    for (let i = 0; i < data.scores.length; i++) {
      const key = data.scores[i]!.name.toLowerCase().trim();

      // Duplicate detection in the output set
      if (outputKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate candidate name in output (case-folded): "${data.scores[i]!.name}"`,
          path: ["scores", i, "name"],
        });
      }
      outputKeys.add(key);

      // Unknown name (not in the input set)
      if (!expectedKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Output candidate "${data.scores[i]!.name}" not in input set`,
          path: ["scores", i, "name"],
        });
      }
    }

    // 3. Every input name appears in output
    for (const expected of expectedKeys) {
      if (!outputKeys.has(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Input candidate "${expected}" missing from output`,
          path: ["scores"],
        });
      }
    }
  });
}

/**
 * @public
 * Stage 6 per-candidate scoring output. Stage 6 calls the model once per
 * researched candidate (the evidence table for one candidate is too large to
 * batch all candidates into a single call, unlike the deferred pre-research
 * draft's P3-D14 single-call shape). One candidate per call also means no
 * name-echo cross-validation is needed — the orchestrator knows which
 * candidate it asked about.
 *
 *   - `dimension_scores`: all 7 dimensions required (P3-D19 coverage rule).
 *   - `scoring_notes`: optional cross-dimension observations; not persisted
 *     (metadata-not-data policy, PHASE3.md §8).
 */
export const Stage6CandidateScoringOutputSchema = z.object({
  dimension_scores: CandidateDimensionScoresSchema,
  scoring_notes: z.string().max(600).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// Type exports
// ────────────────────────────────────────────────────────────────────────

export type DimensionScoreCell = z.infer<typeof DimensionScoreCellSchema>;
export type CandidateDimensionScores = z.infer<
  typeof CandidateDimensionScoresSchema
>;
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;
export type Stage4ScoringOutput = z.infer<typeof Stage4ScoringOutputSchema>;
export type Stage6CandidateScoringOutput = z.infer<
  typeof Stage6CandidateScoringOutputSchema
>;

/**
 * @public
 * Re-export of DIMENSION_KEYS for consumers of this module that need to
 * iterate the 7 dimensions when computing aggregates or rendering scores.
 * Importing from candidate-scoring keeps Stage 4 consumers from reaching
 * across into venture-profile for a constant that's load-bearing here.
 */
export { DIMENSION_KEYS, type Dimension };
