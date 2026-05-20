import type { Parameter, ParameterTier } from "@/types/parameter";
import { estimateCostUsd } from "./pricing";

/**
 * Stage 5 (M15) cost + time predictor.
 *
 * Pre-flight estimate emitted before a cell-research run kicks off. Hard
 * prerequisite per `M15_SPRINT_PLAN.md` §Demo gate (line 16) — the demo run
 * only proceeds with explicit user "go" after the predictor surfaces a range.
 *
 * Calibration sources:
 *   - M12 (single Opus call, 48 candidates): $0.26, ~114s actual
 *   - M13 (Opus + 6 Exa searches): ~$0.40-0.55, ~130-155s actual
 *   - Model pricing: `src/lib/openrouter/pricing.ts`
 *   - Per-tier budgets below are conservative — actual cost/latency comes
 *     back in `llm_call_logs` and we'll re-tune from telemetry after the
 *     first Schneider run lands.
 *
 * Methodology is intentionally back-of-envelope. The point is to scream
 * if the number jumps an order of magnitude — not to be on the dollar.
 */

const DEFAULT_T1_MODEL = "anthropic/claude-opus-4.7";
const DEFAULT_T2_MODEL = "anthropic/claude-opus-4.7";
// T3 extraction: Sonnet 4.6 over Haiku 4.5 — confirmed 2026-05-19 in
// conversation. Haiku struggles with messy Exa snippets; Sonnet is the
// right quality/cost trade for the venture-specific differentiator cells.
// Swap via `STAGE_5_TIER_3_MODEL` env var if needed.
const DEFAULT_T3_EXTRACTION_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Per-tier token budgets. The "min" and "max" envelope the realistic spread
 * of input + output sizes given the prompt shapes specified in
 * `M15_SPRINT_PLAN.md` file map.
 *
 * Universal (T1): batched per candidate. Input = profile + candidate +
 *   ~15 param hints. Output = ~15 cells × ~120 tokens.
 *
 * Framework (T2): batched per candidate. Input grows due to M13 citation
 *   block being passed in as evidence. Output = ~21 cells × ~140 tokens.
 *
 * Dynamic per-cell (T3): one Haiku/Sonnet extraction per cell. Input =
 *   one param hint + 3 Exa snippets (~500 chars each = ~375 tokens × 3).
 *   Output = one cell value + citation + confidence (~150-300 tokens).
 */
const TIER_TOKEN_BUDGETS = {
  universal: {
    input: { min: 4_000, max: 6_000 },
    output: { min: 1_500, max: 2_500 },
  },
  framework: {
    input: { min: 6_500, max: 10_000 },
    output: { min: 2_200, max: 3_800 },
  },
  dynamic_per_cell: {
    input: { min: 1_500, max: 2_800 },
    output: { min: 120, max: 300 },
  },
} as const;

/**
 * Per-call wall-clock estimates (ms). Opus 4.7 sustained generation rate is
 * roughly 30-50 tokens/sec; Haiku 4.5 is ~80-150 tokens/sec. Network +
 * cold-start adds ~1-3s on top.
 */
const TIER_LATENCY_MS = {
  universal: { min: 90_000, max: 120_000 },
  framework: { min: 120_000, max: 180_000 },
  dynamic_per_cell: { min: 6_000, max: 15_000 },
} as const;

/**
 * Exa neural search cost per call. Verify against
 * https://exa.ai/pricing when account tier changes.
 * (Public starter pricing is $0.005 / search; team tiers are cheaper.)
 */
const EXA_COST_PER_SEARCH_USD = 0.005;

/**
 * Tier 3 broadening retry rate. Design doc §Tier 3 fallback chain: if Exa
 * returns zero hits, the orchestrator retries once with a broadened query.
 * Empirical guess pending the first Schneider run — assumes ~20% of T3
 * cells trigger a retry. Errs high so the cost range upper bound is honest.
 */
const T3_BROADEN_RETRY_RATE = 0.2;

/**
 * Within-candidate T3 concurrency cap (`M15_DESIGN.md` §Concurrency, line 135).
 * 15 Tier 3 cells run 3-wide → 5 serial batches per candidate.
 */
const T3_CONCURRENCY = 3;

/**
 * M15-F2: number of corporate-evidence Exa queries the T2 pre-search step
 * runs before the batched Opus call. Five queries × 2 results = ~10 URLs
 * combined with M13 citations as the T2 evidence pool. Kept in lock-step
 * with `T2_PRESEARCH_QUERIES.length` in `src/server/stage5-cells.ts`.
 */
const T2_PRESEARCH_QUERIES_PER_CANDIDATE = 5;

/**
 * M15-F2 latency contribution per candidate. The 5 pre-search queries run in
 * parallel (Promise.allSettled), so wall-clock is roughly one Exa call's
 * latency, not 5×.
 */
const T2_PRESEARCH_LATENCY_MS = { min: 3_000, max: 6_000 } as const;

const DEFAULT_PER_VENTURE_BUDGET_CAP_USD = 100;

export type Tier = ParameterTier;

export interface PredictionRange {
  /** USD or ms, depending on context. */
  min: number;
  max: number;
}

export interface TierBreakdown {
  tier: Tier;
  cells: number;
  /** Approximate Opus/Haiku LLM calls in this tier. Excludes Exa searches. */
  llmCalls: number;
  /** Exa searches in this tier. Zero for T1/T2; ~cells × (1 + retry rate) for T3. */
  exaSearches: number;
  costUsd: PredictionRange;
  /** Per-candidate latency contribution from this tier (within one candidate). */
  latencyMsPerCandidate: PredictionRange;
}

export interface Prediction {
  candidateCount: number;
  totalCells: number;
  /** Combined LLM call count across all candidates and tiers. */
  totalLlmCalls: number;
  /** Combined Exa search count (T3 only) across all candidates. */
  totalExaSearches: number;
  costUsd: PredictionRange;
  /** Sequential wall-clock latency for the whole run (V1 ships sequential per design doc). */
  latencyMs: PredictionRange;
  /** True when the upper bound is within 20% of the per-venture cap (an early warning). */
  approachingBudgetCap: boolean;
  /** True when the upper bound exceeds the per-venture cap (hard halt expected). */
  exceedsBudgetCap: boolean;
  breakdown: TierBreakdown[];
}

export interface PredictArgs {
  /**
   * Merged Tier 1 + 2 + 3 parameter schema — typically
   * `parameter_generation_runs.full_parameter_schema` for the venture.
   */
  parameters: Parameter[];
  /** How many candidates this run will research. V1 ships with 1 (Schneider). */
  candidateCount: number;
  /**
   * Optional model overrides. Falls back to `STAGE_5_*` env vars then the
   * defaults at the top of this file.
   */
  models?: {
    universal?: string;
    framework?: string;
    dynamicExtraction?: string;
  };
  /** Defaults to $100 per `M15_SPRINT_PLAN.md` Clarification #6 / P3-D27. */
  perVentureBudgetCapUsd?: number;
}

export function predictStage5Cost(args: PredictArgs): Prediction {
  if (args.candidateCount < 1) {
    throw new RangeError(
      `predictStage5Cost: candidateCount must be ≥ 1, got ${args.candidateCount}`,
    );
  }
  if (args.parameters.length === 0) {
    throw new RangeError(
      "predictStage5Cost: parameters array is empty — nothing to research",
    );
  }

  const counts = countByTier(args.parameters);
  const t1Model =
    args.models?.universal ??
    process.env.STAGE_5_TIER_1_MODEL ??
    DEFAULT_T1_MODEL;
  const t2Model =
    args.models?.framework ??
    process.env.STAGE_5_TIER_2_MODEL ??
    DEFAULT_T2_MODEL;
  const t3Model =
    args.models?.dynamicExtraction ??
    process.env.STAGE_5_TIER_3_MODEL ??
    DEFAULT_T3_EXTRACTION_MODEL;

  const t1 = estimateBatchedTier(
    "universal",
    counts.universal,
    args.candidateCount,
    t1Model,
  );
  const t2 = estimateBatchedTier(
    "framework",
    counts.framework,
    args.candidateCount,
    t2Model,
  );
  // M15-F2: T2's batched Opus call is preceded by 5 parallel Exa
  // corporate-evidence searches. Roll the pre-search cost + latency into
  // the T2 tier so the breakdown's "framework" line matches the actual
  // wall-clock and spend of the T2 path end-to-end.
  if (counts.framework > 0) {
    const t2PresearchCost =
      T2_PRESEARCH_QUERIES_PER_CANDIDATE *
      EXA_COST_PER_SEARCH_USD *
      args.candidateCount;
    t2.costUsd = {
      min: t2.costUsd.min + t2PresearchCost,
      max: t2.costUsd.max + t2PresearchCost,
    };
    t2.exaSearches += T2_PRESEARCH_QUERIES_PER_CANDIDATE * args.candidateCount;
    t2.latencyMsPerCandidate = {
      min: t2.latencyMsPerCandidate.min + T2_PRESEARCH_LATENCY_MS.min,
      max: t2.latencyMsPerCandidate.max + T2_PRESEARCH_LATENCY_MS.max,
    };
  }
  const t3 = estimateDynamicTier(counts.dynamic, args.candidateCount, t3Model);

  const breakdown: TierBreakdown[] = [t1, t2, t3];

  const costUsd: PredictionRange = {
    min: breakdown.reduce((acc, b) => acc + b.costUsd.min, 0),
    max: breakdown.reduce((acc, b) => acc + b.costUsd.max, 0),
  };

  const latencyMs: PredictionRange = {
    min:
      breakdown.reduce((acc, b) => acc + b.latencyMsPerCandidate.min, 0) *
      args.candidateCount,
    max:
      breakdown.reduce((acc, b) => acc + b.latencyMsPerCandidate.max, 0) *
      args.candidateCount,
  };

  const cap = args.perVentureBudgetCapUsd ?? DEFAULT_PER_VENTURE_BUDGET_CAP_USD;

  return {
    candidateCount: args.candidateCount,
    totalCells: (counts.universal + counts.framework + counts.dynamic) * args.candidateCount,
    totalLlmCalls: breakdown.reduce((acc, b) => acc + b.llmCalls, 0),
    totalExaSearches: breakdown.reduce((acc, b) => acc + b.exaSearches, 0),
    costUsd,
    latencyMs,
    approachingBudgetCap: costUsd.max >= cap * 0.8 && costUsd.max < cap,
    exceedsBudgetCap: costUsd.max >= cap,
    breakdown,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

function countByTier(parameters: Parameter[]): {
  universal: number;
  framework: number;
  dynamic: number;
} {
  const counts = { universal: 0, framework: 0, dynamic: 0 };
  for (const p of parameters) {
    counts[p.tier] += 1;
  }
  return counts;
}

/**
 * One batched Opus call per candidate (T1 or T2). Token budgets are mostly
 * fixed per call regardless of cell count within typical ranges (15-21), so
 * we scale output linearly with cell count to stay honest if the schema
 * grows in the future.
 */
function estimateBatchedTier(
  tier: "universal" | "framework",
  cellsPerCandidate: number,
  candidateCount: number,
  modelId: string,
): TierBreakdown {
  const budget = TIER_TOKEN_BUDGETS[tier];
  const latency = TIER_LATENCY_MS[tier];

  // Expected baseline = 15 cells for universal, 21 for framework. Scale
  // output proportionally if cellsPerCandidate diverges.
  const baseline = tier === "universal" ? 15 : 21;
  const outputScale = cellsPerCandidate === 0 ? 0 : cellsPerCandidate / baseline;

  const perCallMin = estimateCostUsd(
    modelId,
    budget.input.min,
    budget.output.min * outputScale,
  );
  const perCallMax = estimateCostUsd(
    modelId,
    budget.input.max,
    budget.output.max * outputScale,
  );

  const llmCalls = cellsPerCandidate === 0 ? 0 : candidateCount;

  return {
    tier,
    cells: cellsPerCandidate * candidateCount,
    llmCalls,
    exaSearches: 0,
    costUsd: {
      min: perCallMin * llmCalls,
      max: perCallMax * llmCalls,
    },
    latencyMsPerCandidate: cellsPerCandidate === 0
      ? { min: 0, max: 0 }
      : { min: latency.min, max: latency.max },
  };
}

/**
 * Per-cell Exa + Haiku/Sonnet path for T3. Concurrency reduces per-candidate
 * latency by the cap, but cost scales linearly with cell count.
 */
function estimateDynamicTier(
  cellsPerCandidate: number,
  candidateCount: number,
  extractionModelId: string,
): TierBreakdown {
  if (cellsPerCandidate === 0) {
    return {
      tier: "dynamic",
      cells: 0,
      llmCalls: 0,
      exaSearches: 0,
      costUsd: { min: 0, max: 0 },
      latencyMsPerCandidate: { min: 0, max: 0 },
    };
  }

  const budget = TIER_TOKEN_BUDGETS.dynamic_per_cell;
  const latency = TIER_LATENCY_MS.dynamic_per_cell;

  const totalCells = cellsPerCandidate * candidateCount;
  // Exa searches: every cell pays at least one, ~T3_BROADEN_RETRY_RATE pay two (worst case).
  const exaSearchesMin = totalCells;
  const exaSearchesMax = Math.ceil(totalCells * (1 + T3_BROADEN_RETRY_RATE));

  const exaCostMin = exaSearchesMin * EXA_COST_PER_SEARCH_USD;
  const exaCostMax = exaSearchesMax * EXA_COST_PER_SEARCH_USD;

  const extractionCostPerCellMin = estimateCostUsd(
    extractionModelId,
    budget.input.min,
    budget.output.min,
  );
  const extractionCostPerCellMax = estimateCostUsd(
    extractionModelId,
    budget.input.max,
    budget.output.max,
  );

  const extractionCostMin = extractionCostPerCellMin * totalCells;
  const extractionCostMax = extractionCostPerCellMax * totalCells;

  // Per-candidate latency: cells run T3_CONCURRENCY-wide. Round up to model
  // the last batch fairly when cellsPerCandidate isn't a clean multiple.
  const serialBatches = Math.ceil(cellsPerCandidate / T3_CONCURRENCY);

  return {
    tier: "dynamic",
    cells: totalCells,
    // One Haiku/Sonnet extraction per cell. Broadening retry re-runs Exa but
    // does NOT re-run the extraction model (the broadened search either hits
    // or we fall through to confidence='unknown' with no extraction needed).
    llmCalls: totalCells,
    exaSearches: exaSearchesMax,
    costUsd: {
      min: exaCostMin + extractionCostMin,
      max: exaCostMax + extractionCostMax,
    },
    latencyMsPerCandidate: {
      min: serialBatches * latency.min,
      max: serialBatches * latency.max,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Display helpers — used by the UI predictor card.
// ──────────────────────────────────────────────────────────────────────────

export function formatCostRange(range: PredictionRange): string {
  return `$${range.min.toFixed(2)} – $${range.max.toFixed(2)}`;
}

export function formatLatencyRange(range: PredictionRange): string {
  const minMin = Math.round(range.min / 60_000);
  const maxMin = Math.round(range.max / 60_000);
  if (minMin === maxMin) return `~${minMin} min`;
  return `~${minMin}–${maxMin} min`;
}
