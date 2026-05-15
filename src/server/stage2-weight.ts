import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "@/lib/openrouter/errors";
import { loadPrompt } from "@/lib/prompts";
import { errorMessage } from "@/lib/utils";
import {
  DIMENSION_KEYS,
  Stage2WeightingOutputSchema,
  VentureProfileSchema,
  type Dimension,
  type Stage2WeightingOutput,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_2_weight";

// claude.md §12: Stage 1 uses 180s; Stage 2's input is just the profile JSON
// (no source docs), so it's smaller and faster. 60s default is plenty.
const STAGE_2_TIMEOUT_MS = 60_000;

// claude.md §11 + §13: weights are accepted if they sum within this window
// (the renormalizer normalizes to exactly 1.0 inside it). Outside this band
// we reject — too far from 1.0 suggests the model is calibrated wrong, not
// just slightly off, and silent normalization would hide that.
const SUM_TOLERANCE_LOW = 0.95;
const SUM_TOLERANCE_HIGH = 1.05;

// The downstream score in evals expects an exact-1.0 sum. We normalize to
// that after validation, so the inserted rows always sum to 1.0 modulo
// floating-point dust.
const NORMALIZED_TARGET_SUM = 1.0;

const DEFAULT_STAGE_2_MODEL = "anthropic/claude-opus-4.7";

const DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON will be appended below\]\s*$/;

/**
 * @public
 * Input to {@link runStage2Weighting}.
 */
export interface RunStage2WeightingInput {
  ventureId: string;
  insforge: InsForgeClient;
}

/**
 * @public
 * Result of {@link runStage2Weighting}.
 *
 *   - `ok: true` — Stage 2 ran, 7 `dimension_weights` rows were inserted with
 *     `source='llm_proposed'`, venture is in `status='weighting'`. The user
 *     reviews + confirms via the weights UI which transitions to `status='ready'`.
 *   - `ok: false` — Hard failure (budget exhausted, sum out of tolerance,
 *     no profile to weight, DB write failure). Venture is in `status='error'`.
 *
 * Unlike the critic, Stage 2 has no soft-fail mode (D3 is critic-specific).
 * A failure here halts the pipeline and surfaces to the user.
 */
export type RunStage2WeightingResult =
  | {
      ok: true;
      profileVersionId: string;
      runId: string | null;
      weightsRowIds: string[];
      costUsd: number;
      latencyMs: number;
      normalizedFrom: number;
    }
  | { ok: false; error: string };

interface VentureRow {
  id: string;
  current_run_id: string | null;
}

interface ProfileVersionRow {
  id: string;
  source: string;
  profile_json: unknown;
}

interface InsertedDimensionWeight {
  id: string;
}

/**
 * @public
 * Stage 2 (M10): assign importance weights across the 7 dimensions for the
 * current venture. Reads the latest `human_refined` profile (falling back to
 * the latest `llm_extracted` if none has been refined yet), calls Opus 4.7
 * with the Stage 2 prompt, validates the model output against
 * `Stage2WeightingOutputSchema`, renormalizes the weights to sum to 1.0
 * (provided they're within the [0.95, 1.05] tolerance band), and inserts 7
 * `dimension_weights` rows with `source='llm_proposed'`.
 *
 * Budget: reuses `ventures.current_run_id` so the per-run $5 cap (D4) spans
 * the full Stage 1 + critic + Stage 2 cycle. Re-running Stage 2 against the
 * same run consumes additional budget.
 *
 * Lifecycle:
 *   - On entry: expects `status='weighting'` (set by HITL "Confirm to
 *     continue"). Does not change `status` on entry; the caller already did.
 *   - On success: leaves `status='weighting'`. The weights UI shows the
 *     proposed weights, lets the user adjust (inserting `human_adjusted`
 *     rows), and transitions to `status='ready'` on confirm.
 *   - On failure: transitions `status='error'`, stamps `error_message`.
 */
export async function runStage2Weighting(
  input: RunStage2WeightingInput,
): Promise<RunStage2WeightingResult> {
  const { ventureId, insforge } = input;

  try {
    const { runId, profileVersion } = await loadWeightingInputs(
      insforge,
      ventureId,
    );

    if (!profileVersion) {
      throw new OrchestratorError(
        "No profile_versions row found for this venture. Stage 1 must complete (and ideally HITL refinement) before Stage 2 runs.",
      );
    }

    const promptBody = await loadPrompt("stage_2_dimension_weighting.md");
    const prompt = assembleWeightingPrompt(
      promptBody,
      profileVersion.profile as VentureProfile,
    );

    const model = process.env.STAGE_2_MODEL ?? DEFAULT_STAGE_2_MODEL;

    const result = await callLLM<Stage2WeightingOutput>({
      insforge,
      model,
      stage: STAGE,
      prompt,
      ventureId,
      runId,
      schema: Stage2WeightingOutputSchema,
      timeoutMs: STAGE_2_TIMEOUT_MS,
    });

    const { normalized, originalSum } = normalizeWeights(result.data);

    const weightsRowIds = await insertWeights(insforge, {
      ventureId,
      profileVersionId: profileVersion.id,
      output: normalized,
    });

    return {
      ok: true,
      profileVersionId: profileVersion.id,
      runId,
      weightsRowIds,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      normalizedFrom: originalSum,
    };
  } catch (err) {
    const message = formatErrorForUser(err);
    await insforge.database
      .from("ventures")
      .update({ status: "error", error_message: message })
      .eq("id", ventureId);
    return { ok: false, error: message };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

class WeightSumOutOfRangeError extends Error {
  constructor(
    public readonly sum: number,
    public readonly low: number,
    public readonly high: number,
  ) {
    super(
      `Weights sum to ${sum.toFixed(4)}, outside tolerance [${low}, ${high}]. Model output is mis-calibrated; not normalizing silently.`,
    );
    this.name = "WeightSumOutOfRangeError";
  }
}

async function loadWeightingInputs(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{
  runId: string | null;
  profileVersion: { id: string; profile: VentureProfile } | null;
}> {
  const { data: ventureData, error: ventureError } = await insforge.database
    .from("ventures")
    .select("id, current_run_id")
    .eq("id", ventureId)
    .single();

  if (ventureError || !ventureData) {
    throw new OrchestratorError(
      `Venture not found or inaccessible: ${ventureError?.message ?? "no row returned"}`,
    );
  }

  const venture = ventureData as unknown as VentureRow;

  // Prefer the most recent human_refined version. If none exist (user hit
  // "Confirm to continue" without editing any dimension — valid path), fall
  // back to the latest llm_extracted. We never weight against llm_critic
  // output; the critic isn't a profile, it's flags on a profile.
  const profile = await loadLatestProfileVersion(insforge, ventureId, [
    "human_refined",
    "llm_extracted",
  ]);

  return {
    runId: venture.current_run_id,
    profileVersion: profile,
  };
}

async function loadLatestProfileVersion(
  insforge: InsForgeClient,
  ventureId: string,
  preferenceOrder: string[],
): Promise<{ id: string; profile: VentureProfile } | null> {
  for (const source of preferenceOrder) {
    const { data, error } = await insforge.database
      .from("profile_versions")
      .select("id, source, profile_json")
      .eq("venture_id", ventureId)
      .eq("source", source)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new OrchestratorError(
        `Failed to load profile_versions for source=${source}: ${error.message}`,
      );
    }

    if (data) {
      const row = data as unknown as ProfileVersionRow;
      // Validate before passing to the model. A structurally broken stored
      // profile would otherwise burn an LLM call to discover.
      const parsed = VentureProfileSchema.safeParse(row.profile_json);
      if (!parsed.success) {
        throw new OrchestratorError(
          `Stored profile (source=${source}, id=${row.id}) does not validate against current schema: ${parsed.error.message}`,
        );
      }
      return { id: row.id, profile: parsed.data };
    }
  }
  return null;
}

function assembleWeightingPrompt(
  promptBody: string,
  profile: VentureProfile,
): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();
  return [
    stripped,
    "",
    "## VentureX profile (JSON)",
    "",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
  ].join("\n");
}

/**
 * Validates the weights sum within tolerance and normalizes to exactly 1.0.
 * The schema already constrains each weight to [0, 1]; this layer constrains
 * the aggregate.
 *
 * Throws WeightSumOutOfRangeError if the sum is outside [0.95, 1.05] — we'd
 * rather surface a mis-calibrated model than silently normalize an output
 * that's structurally wrong.
 */
function normalizeWeights(output: Stage2WeightingOutput): {
  normalized: Stage2WeightingOutput;
  originalSum: number;
} {
  const sum = DIMENSION_KEYS.reduce(
    (acc, key) => acc + output.weights[key].weight,
    0,
  );

  if (sum < SUM_TOLERANCE_LOW || sum > SUM_TOLERANCE_HIGH) {
    throw new WeightSumOutOfRangeError(
      sum,
      SUM_TOLERANCE_LOW,
      SUM_TOLERANCE_HIGH,
    );
  }

  if (Math.abs(sum - NORMALIZED_TARGET_SUM) < 1e-6) {
    return { normalized: output, originalSum: sum };
  }

  const factor = NORMALIZED_TARGET_SUM / sum;
  const normalizedWeights = {} as Stage2WeightingOutput["weights"];
  for (const key of DIMENSION_KEYS) {
    normalizedWeights[key] = {
      weight: output.weights[key].weight * factor,
      rationale: output.weights[key].rationale,
    };
  }

  return {
    normalized: { ...output, weights: normalizedWeights },
    originalSum: sum,
  };
}

async function insertWeights(
  insforge: InsForgeClient,
  args: {
    ventureId: string;
    profileVersionId: string;
    output: Stage2WeightingOutput;
  },
): Promise<string[]> {
  // Build all 7 rows in one insert call. InsForge's `.insert([...])` accepts
  // an array — single round-trip vs. 7 sequential inserts.
  const rows = DIMENSION_KEYS.map((dim: Dimension) => ({
    venture_id: args.ventureId,
    profile_version_id: args.profileVersionId,
    dimension: dim,
    weight: args.output.weights[dim].weight,
    rationale: args.output.weights[dim].rationale,
    source: "llm_proposed" as const,
  }));

  const { data, error } = await insforge.database
    .from("dimension_weights")
    .insert(rows)
    .select("id");

  if (error || !data) {
    throw new OrchestratorError(
      `Failed to insert dimension_weights rows: ${error?.message ?? "no rows returned"}`,
    );
  }

  return (data as InsertedDimensionWeight[]).map((r) => r.id);
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof TokenLimitError) {
    return `Stage 2 input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}). The profile is unusually large; contact engineering.`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted before Stage 2 could complete: $${err.currentCostUsd.toFixed(4)} already spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}. Re-run from extraction to reset the budget.`;
  }
  if (err instanceof LLMValidationError) {
    return `Stage 2 model output failed validation after ${err.attempts} attempt(s).`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Stage 2 OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof WeightSumOutOfRangeError) {
    return err.message;
  }
  if (err instanceof OrchestratorError) {
    return err.message;
  }
  return errorMessage(err);
}
