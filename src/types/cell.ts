import { z } from "zod";

import { ParameterTierSchema } from "./parameter";

// ────────────────────────────────────────────────────────────────────────
// Stage 5 Cell Research output (M15)
//
// Each (candidate, parameter) cell carries a value, a citation (when
// applicable per tier), and a confidence tri-state. See M15_DESIGN.md
// §Premises P5 and M15_SPRINT_PLAN.md file map for the load-bearing rules:
//
//   - Tier 1 universal — training-data only; citation OPTIONAL (null OK).
//   - Tier 2 framework — citation REQUIRED, echoing one M13 citation URL.
//   - Tier 3 dynamic   — citation REQUIRED from supplied Exa hits, OR
//                        confidence='unknown' + null value + null citation
//                        when Exa returned no usable evidence even after
//                        the broadening retry (design doc §Tier 3 fallback).
//
// P3-D19 strict factories: each batched tier's output must contain exactly
// one cell per input parameter_key. Missing keys trigger LLMValidationError
// → callLLM retry-once → hard fail; mirrors Stage 4's coverage-floor
// invariant.
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * Confidence tri-state. P3-D23 locked this as an enum (not a numeric score)
 * after Daniel/Innovera confirmed the analysis engine consumes the categorical
 * signal directly. No parallel numeric column.
 *
 *   - `verified` — value is directly supported by the cited evidence.
 *   - `inferred` — value is a reasonable inference (clearly indicated as such
 *     in the rationale) from adjacent evidence.
 *   - `unknown` — no usable evidence found; value MUST be null and citation
 *     MUST be null. Honest gap.
 */
export const CellConfidenceSchema = z.enum(["verified", "inferred", "unknown"]);

/**
 * @public
 * Tier of the parameter that produced this cell. Denormalised onto cells
 * (matching the migration 0007 column) so dossier reads + tier-resume don't
 * need a jsonb lookup back into `parameter_generation_runs.full_parameter_schema`.
 *
 * The enum literal matches `ParameterTierSchema` exactly — we re-export it
 * here so cell-side consumers don't need to import from `parameter.ts`.
 */
export const CellTierSchema = ParameterTierSchema;

/**
 * @internal
 * "Empty value" detector. The model often returns `[]` or `{}` instead of
 * `null` when a list/object parameter has no usable evidence — the cell
 * schemas treat these as null when paired with `confidence='unknown'` to
 * avoid burning a callLLM retry on a semantic equivalence.
 *
 * Whitespace-only strings, undefined, and `null` itself all count as empty.
 */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Coerce empty values to `null` when `confidence='unknown'`. Applied via
 * `z.preprocess` on every per-tier cell schema so the model can return
 * `[]` / `{}` / `""` for "I don't know" without burning a retry.
 */
function coerceEmptyValueOnUnknown(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const cell = input as Record<string, unknown>;
  if (cell.confidence === "unknown" && isEmptyValue(cell.value)) {
    return { ...cell, value: null };
  }
  return input;
}

/**
 * @public
 * Citation attached to a Stage 5 cell. Distinct from `M13` citation shape
 * (`candidate.ts`) — that one is keyed by `query` (the implies_search_for
 * string); cells are keyed by parameter_key already so we store the snippet
 * + retrieval timestamp inline for fast verification UI.
 *
 * Bounds rationale:
 *   - `url`: must be a valid URL. For T2 cells, this MUST be a URL that
 *     appeared in the candidate's M13 citation set (enforced by the prompt,
 *     not Zod — Zod can't see the per-call evidence set).
 *   - `title`: 0-300 chars (allowing empty — Exa occasionally returns no
 *     title on PDF-like targets and we'd rather store the URL than reject).
 *   - `snippet`: 1-1500 chars. Exa default snippet cap is 1000 (see
 *     `src/lib/exa/search.ts` DEFAULT_MAX_CHARS_PER_RESULT); 1500 gives
 *     headroom for the orchestrator to attach a slightly longer extract
 *     when the cell value is paragraph-budget.
 *   - `retrieved_at`: ISO 8601 timestamp string. Verification UI shows
 *     this as the "freshness" badge; Innovera weights recent citations
 *     higher.
 */
export const CellCitationSchema = z.object({
  url: z.string().url(),
  title: z.string().max(300),
  snippet: z.string().min(1).max(1500),
  retrieved_at: z.string().min(1).max(80),
});

/**
 * @public
 * The persisted cell row. Matches migration 0007's `cells` table column
 * shape one-for-one. Used both for read-back validation and for the row
 * the orchestrator builds before insert.
 *
 * `value` is intentionally `unknown` — the actual value type varies per
 * parameter (`parameter.value_type`). Per-value-type validation is
 * deferred to M16 polish; V1 trusts the per-tier prompt + Zod refinements
 * below to keep shapes sane.
 *
 * Invariants enforced by `.superRefine`:
 *   1. `confidence='unknown'` ⇒ value MUST be null AND citation MUST be null.
 *      (Honest gap. The cell is admitting it has no evidence.)
 *   2. `confidence` in {`verified`,`inferred`} ⇒ value MAY be null when the
 *      fact is *legitimately absent* (e.g., `parent_company` of a standalone
 *      public company, `stock_ticker` of a private company). The distinction
 *      between "verified absence" and "unknown gap" lives in `confidence`.
 *      (Citation requirement for T2/T3 is enforced in the tier output
 *      schemas + orchestrator post-check against the supplied evidence set.)
 */
export const CellRowSchema = z
  .object({
    candidate_id: z.string().uuid(),
    parameter_key: z.string().min(1).max(80),
    tier: CellTierSchema,
    value: z.unknown().nullable(),
    citation: CellCitationSchema.nullable(),
    confidence: CellConfidenceSchema,
    reason: z.string().max(2000).nullable(),
    llm_call_id: z.string().uuid().nullable(),
  })
  .superRefine((row, ctx) => {
    if (row.confidence === "unknown") {
      if (row.value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires value to be null",
          path: ["value"],
        });
      }
      if (row.citation !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires citation to be null",
          path: ["citation"],
        });
      }
    }
  });

// ────────────────────────────────────────────────────────────────────────
// Per-tier LLM output schemas
//
// These describe what each tier's PROMPT emits. The orchestrator combines
// the model output with parameter_key + tier + llm_call_id metadata to
// build the CellRow it writes. Keeping the LLM schema narrower than the
// row shape means we don't ask the model to echo metadata it doesn't need
// to know about.
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * Single cell output from the Tier 1 batched prompt. Citation OPTIONAL
 * (training-data values for stable identity facts — design doc §Success
 * Criteria #1 specifies NO citation requirement for T1).
 */
const Tier1CellBaseSchema = z
  .object({
    parameter_key: z.string().min(1).max(80),
    value: z.unknown().nullable(),
    citation: CellCitationSchema.nullable(),
    confidence: CellConfidenceSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .superRefine((cell, ctx) => {
    if (cell.confidence === "unknown") {
      if (cell.value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires value to be null",
          path: ["value"],
        });
      }
    }
    // Note: `verified`/`inferred` + value=null is VALID for T1 — many
    // identity facts are legitimately absent (e.g., `parent_company` for
    // a standalone public company, `stock_ticker` for a private company).
    // The model returns null in those cases per the parameter's prompt_hint.
  });

export const Tier1CellOutputSchema = z.preprocess(
  coerceEmptyValueOnUnknown,
  Tier1CellBaseSchema,
);

/**
 * @public
 * Single cell output from the Tier 2 batched prompt. Citation REQUIRED
 * (must echo a URL from the supplied M13 citation set) unless the model
 * explicitly declines with `confidence='unknown'`.
 *
 * Zod cannot enforce "URL must be from the M13 set" — the orchestrator
 * post-checks this against the candidate's `candidate_companies.citations`
 * after Zod parses the shape.
 */
/**
 * Tier 2 per-cell schema. NOTE: the per-cell citation requirement is
 * intentionally NOT enforced here — citation_required varies per parameter
 * in the framework catalog (e.g., `customer_segment_type` is an enum
 * classification with `citation_required: false`). The orchestrator
 * enforces the per-parameter rule in its post-validation step where it
 * has access to the full parameter schema.
 *
 * What this schema DOES enforce: `confidence='unknown'` ⇒ value AND
 * citation both null (after the empty-coercion preprocess).
 */
const Tier2CellBaseSchema = z
  .object({
    parameter_key: z.string().min(1).max(80),
    value: z.unknown().nullable(),
    citation: CellCitationSchema.nullable(),
    confidence: CellConfidenceSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .superRefine((cell, ctx) => {
    if (cell.confidence === "unknown") {
      if (cell.value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires value to be null",
          path: ["value"],
        });
      }
      if (cell.citation !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires citation to be null",
          path: ["citation"],
        });
      }
    }
  });

export const Tier2CellOutputSchema = z.preprocess(
  coerceEmptyValueOnUnknown,
  Tier2CellBaseSchema,
);

/**
 * @public
 * Single cell output from the Tier 3 per-cell extraction prompt. Citation
 * REQUIRED (must be one of the supplied Exa URLs) unless the model returns
 * `confidence='unknown'` with null value + null citation (design doc
 * §Tier 3 fallback chain).
 *
 * The orchestrator post-checks the citation URL appears in the Exa results
 * actually passed in — Zod can't see the per-call evidence set.
 */
/**
 * Tier 3 per-cell schema. Citation required for verified/inferred cells —
 * `DynamicParameterSchema` constrains every Tier 3 param to
 * `citation_required: literal(true)`, so the per-cell rule applies
 * uniformly here. The orchestrator additionally post-checks that the
 * citation URL appears in the supplied Exa results.
 */
const Tier3CellBaseSchema = z
  .object({
    parameter_key: z.string().min(1).max(80),
    value: z.unknown().nullable(),
    citation: CellCitationSchema.nullable(),
    confidence: CellConfidenceSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .superRefine((cell, ctx) => {
    if (cell.confidence === "unknown") {
      if (cell.value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires value to be null",
          path: ["value"],
        });
      }
      if (cell.citation !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence='unknown' requires citation to be null",
          path: ["citation"],
        });
      }
    } else if (cell.citation === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tier 3 cells require a citation unless confidence='unknown'`,
        path: ["citation"],
      });
    }
  });

export const Tier3CellOutputSchema = z.preprocess(
  coerceEmptyValueOnUnknown,
  Tier3CellBaseSchema,
);

// ────────────────────────────────────────────────────────────────────────
// Batched tier outputs (T1 + T2 — one Opus call per candidate)
//
// Shape-only schemas plus a strict factory that cross-validates the cells
// array against the expected parameter_keys supplied at call time. Mirrors
// makeStrictStage4ScoringOutputSchema (P3-D19) — Zod refinements have no
// access to external state, so the factory closure carries the comparand.
// ────────────────────────────────────────────────────────────────────────

export const Tier1BatchOutputSchema = z.object({
  cells: z.array(Tier1CellOutputSchema).min(1).max(40),
  notes: z.string().max(800).optional(),
});

export const Tier2BatchOutputSchema = z.object({
  cells: z.array(Tier2CellOutputSchema).min(1).max(40),
  notes: z.string().max(800).optional(),
});

/**
 * @public
 * Build a strict Tier 1 batch schema that enforces:
 *   1. cells.length === expectedParameterKeys.length
 *   2. every expected key appears in cells (exact match, case-sensitive
 *      since parameter ids are lowercase-snake by construction)
 *   3. no duplicate parameter_keys in output
 *
 * Why a factory: same reason as makeStrictStage4ScoringOutputSchema —
 * cross-validation needs the expected set from the orchestrator, and Zod
 * refinements don't see external state.
 */
export function makeStrictTier1BatchSchema(expectedParameterKeys: string[]) {
  return makeStrictBatchSchemaInternal(
    Tier1BatchOutputSchema,
    expectedParameterKeys,
    "Tier 1",
  );
}

export function makeStrictTier2BatchSchema(expectedParameterKeys: string[]) {
  return makeStrictBatchSchemaInternal(
    Tier2BatchOutputSchema,
    expectedParameterKeys,
    "Tier 2",
  );
}

function makeStrictBatchSchemaInternal<
  TSchema extends z.ZodObject<{
    cells: z.ZodArray<z.ZodTypeAny>;
    notes: z.ZodOptional<z.ZodString>;
  }>,
>(
  baseSchema: TSchema,
  expectedParameterKeys: string[],
  tierLabel: string,
) {
  const expectedSet = new Set(expectedParameterKeys);

  return baseSchema.superRefine((data, ctx) => {
    const cells = data.cells as Array<{ parameter_key: string }>;

    if (cells.length !== expectedParameterKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${tierLabel} cells.length (${cells.length}) must equal expected parameter count (${expectedParameterKeys.length})`,
        path: ["cells"],
      });
    }

    const seen = new Set<string>();
    for (let i = 0; i < cells.length; i++) {
      const key = cells[i]!.parameter_key;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${tierLabel} duplicate parameter_key in output: "${key}"`,
          path: ["cells", i, "parameter_key"],
        });
      }
      seen.add(key);

      if (!expectedSet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${tierLabel} unexpected parameter_key: "${key}" not in input set`,
          path: ["cells", i, "parameter_key"],
        });
      }
    }

    for (const expected of expectedSet) {
      if (!seen.has(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${tierLabel} missing parameter_key: "${expected}"`,
          path: ["cells"],
        });
      }
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Type exports
// ────────────────────────────────────────────────────────────────────────

export type CellConfidence = z.infer<typeof CellConfidenceSchema>;
export type CellTier = z.infer<typeof CellTierSchema>;
export type CellCitation = z.infer<typeof CellCitationSchema>;
export type CellRow = z.infer<typeof CellRowSchema>;
export type Tier1CellOutput = z.infer<typeof Tier1CellOutputSchema>;
export type Tier2CellOutput = z.infer<typeof Tier2CellOutputSchema>;
export type Tier3CellOutput = z.infer<typeof Tier3CellOutputSchema>;
export type Tier1BatchOutput = z.infer<typeof Tier1BatchOutputSchema>;
export type Tier2BatchOutput = z.infer<typeof Tier2BatchOutputSchema>;
