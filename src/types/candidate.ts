import { z } from "zod";

import { DIMENSION_KEYS } from "./venture-profile";

// ────────────────────────────────────────────────────────────────────────
// Stage 3 Candidate Generation output (PHASE3.md §4, M12)
//
// The model returns 10-60 candidate competitor companies for the current
// venture, each tagged with a type (Direct / Category / SPDM) and the
// venture dimensions that motivate its relevance. Persisted as rows in
// `candidate_companies` sharing a single `generation_run_id` UUID.
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * The three competitor categories defined in CLAUDE.md §2 (shared vocabulary):
 *
 *   - `direct` — same Job-to-be-Done, same solution mechanism.
 *   - `category` — same solution mechanism, different JTBD (i.e., adjacent
 *     applications of similar technology).
 *   - `same_problem_different_mechanism` (SPDM) — same JTBD, different
 *     mechanism. Sourced from the load-bearing
 *     `dimensions.product_solution.substitution_landscape` field.
 *
 * The fourth "adjacent competitors" category was explicitly killed in CLAUDE.md
 * §2 — do not reintroduce.
 */
export const CandidateTypeSchema = z.enum([
  "direct",
  "category",
  "same_problem_different_mechanism",
]);

// The 7 dimension keys, re-exported as a Zod enum tuple so callers can use it
// in array contexts. DIMENSION_KEYS is the runtime source of truth; this is
// just the schema-layer mirror.
const DimensionEnumSchema = z.enum(DIMENSION_KEYS);

/**
 * @public
 * One web-evidence citation attached to a candidate (M13). The model emits
 * these only when the candidate is grounded in an entry from the Stage 3
 * "## Web evidence" block; training-data-only candidates omit `citations`
 * entirely (see CandidateCompanySchema below).
 *
 * Bounds rationale:
 *   - `url`: must be a valid URL. The orchestrator passes Exa-returned URLs
 *     into the prompt and the model is told never to invent URLs — if a bad
 *     URL appears, validation fails and callLLM's retry-once fires.
 *   - `title`: 1-300 chars. Exa titles are typically <100 but news / paper
 *     titles can run longer. 300 is a generous ceiling.
 *   - `query`: 1-500 chars. This is the `implies_search_for` string from
 *     the venture's strategic_risks_and_uncertainties that triggered the
 *     search returning this hit — used to trace a citation back to the
 *     risk it grounded.
 */
export const CitationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(300),
  query: z.string().min(1).max(500),
});

/**
 * @public
 * One candidate. Bounds rationale (PHASE3.md §4):
 *
 *   - `name`: 1-200 chars. Some real-world company names run long
 *     ("Hewlett Packard Enterprise") but anything past 200 is a hallucination.
 *   - `rationale`: 1-800 chars (~3 sentences). Same calibration as Stage 1
 *     critic comments.
 *   - `dimensions_implicated`: 1-7 unique dimension keys. At least one
 *     (otherwise the candidate isn't grounded in the venture); at most all
 *     (M12 over-claims here are fine — M14 scoring will rationalize).
 */
export const CandidateCompanySchema = z.object({
  name: z.string().min(1).max(200),
  type: CandidateTypeSchema,
  rationale: z.string().min(1).max(800),
  dimensions_implicated: z
    .array(DimensionEnumSchema)
    .min(1)
    .max(7),
  // Optional per PHASE3.md §6b. Present on M13 candidates grounded in web
  // evidence; absent on training-data-only candidates. Cap of 3 prevents the
  // model from over-citing a single candidate — picks the strongest 3 sources.
  citations: z.array(CitationSchema).max(3).optional(),
});

/**
 * @public
 * The full Stage 3 output. 10-60 candidates per call (PHASE3.md §4):
 *
 *   - `min(10)`: below this we treat it as a model failure; callLLM's
 *     retry-once will fire and a second attempt may clear it.
 *   - `max(60)`: above this the UI gets unwieldy and M14 scoring gets
 *     expensive.
 *
 * `generation_notes` is optional cross-set commentary from the model
 * (e.g., "candidates skew toward US/EU due to training data"). It is NOT
 * persisted to `candidate_companies` (PHASE3.md §8 — not metadata about a
 * specific candidate). The orchestrator may log it to `llm_call_logs` and
 * surface it in the UI as a generation-level note.
 */
export const Stage3CandidatesOutputSchema = z.object({
  candidates: z.array(CandidateCompanySchema).min(10).max(60),
  generation_notes: z.string().max(800).optional(),
});

export type CandidateType = z.infer<typeof CandidateTypeSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type CandidateCompany = z.infer<typeof CandidateCompanySchema>;
export type Stage3CandidatesOutput = z.infer<
  typeof Stage3CandidatesOutputSchema
>;
