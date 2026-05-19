import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "@/lib/openrouter/errors";
import { mergeParameterSchema } from "@/lib/parameters/catalog";
import {
  ParameterValidationError,
  assertUniqueParameterIds,
  validateParameterBuilderOutput,
} from "@/lib/parameters/validation";
import { loadPrompt } from "@/lib/prompts";
import { errorMessage } from "@/lib/utils";
import {
  Stage4ParameterBuilderOutputSchema,
  type DynamicParameter,
  type Parameter,
  type Stage4ParameterBuilderOutput,
} from "@/types/parameter";
import {
  DIMENSION_KEYS,
  VentureProfileSchema,
  type Dimension,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_4_parameters";
const STAGE_4_TIMEOUT_MS = 120_000;
const DEFAULT_STAGE_4_MODEL = "anthropic/claude-opus-4.7";

const DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON, canonical dimension weights, and prior parameter generations will be appended below\]\s*$/;

const PRECONDITION_STATUS = "candidates_ready" as const;
const IN_PROGRESS_STATUS = "parameters_generating" as const;
const SUCCESS_STATUS = "parameters_ready" as const;

export interface RunStage4ParameterBuilderInput {
  ventureId: string;
  insforge: InsForgeClient;
}

export type RunStage4ParameterBuilderResult =
  | {
      ok: true;
      parameterRunId: string;
      profileVersionId: string;
      candidateGenerationRunId: string;
      runId: string | null;
      dynamicParameterCount: number;
      fullParameterCount: number;
      costUsd: number;
      latencyMs: number;
    }
  | { ok: false; error: string };

interface ProfileVersionRow {
  id: string;
  source: string;
  profile_json: unknown;
}

interface DimensionWeightRow {
  dimension: string;
  weight: number;
  rationale: string | null;
  source: string;
  created_at: string;
}

interface CandidateRunRow {
  generation_run_id: string;
  created_at: string;
}

interface ParameterGenerationRunRow {
  id: string;
  dynamic_parameters: unknown;
  generation_notes: string | null;
  created_at: string;
}

interface InsertedParameterRun {
  id: string;
}

type CanonicalWeights = Record<
  Dimension,
  { weight: number; rationale: string | null; source: string }
>;

export async function runStage4ParameterBuilder(
  input: RunStage4ParameterBuilderInput,
): Promise<RunStage4ParameterBuilderResult> {
  const { ventureId, insforge } = input;

  try {
    const runId = await claimCandidatesReadyStatus(insforge, ventureId);

    const { profileVersion, weights, candidateGenerationRunId, priorRuns } =
      await loadParameterInputs(insforge, ventureId);

    const promptBody = await loadPrompt("stage_4_parameter_builder.md");
    const prompt = assembleParameterPrompt(
      promptBody,
      profileVersion.profile,
      weights,
      priorRuns,
    );

    const model = process.env.STAGE_4_PARAMETERS_MODEL ?? DEFAULT_STAGE_4_MODEL;

    const result = await callLLM<Stage4ParameterBuilderOutput>({
      insforge,
      model,
      stage: STAGE,
      prompt,
      ventureId,
      runId,
      schema: Stage4ParameterBuilderOutputSchema,
      timeoutMs: STAGE_4_TIMEOUT_MS,
      estimatedOutputTokens: 4_000,
    });

    const dynamicParameters = validateParameterBuilderOutput(
      result.data,
      profileVersion.profile,
    );
    const fullParameterSchema = mergeParameterSchema(dynamicParameters);
    assertUniqueParameterIds(fullParameterSchema);

    const parameterRunId = await insertParameterRun(insforge, {
      ventureId,
      profileVersionId: profileVersion.id,
      candidateGenerationRunId,
      llmCallId: result.llmCallId,
      dynamicParameters,
      fullParameterSchema,
      generationNotes: result.data.generation_notes ?? null,
    });

    await markParametersReady(insforge, ventureId);

    return {
      ok: true,
      parameterRunId,
      profileVersionId: profileVersion.id,
      candidateGenerationRunId,
      runId,
      dynamicParameterCount: dynamicParameters.length,
      fullParameterCount: fullParameterSchema.length,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
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

class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

class PreconditionError extends Error {
  constructor(public readonly actualStatus: string) {
    super(
      `Parameter Builder requires status='${PRECONDITION_STATUS}' on entry; venture is in status='${actualStatus}'. Generate candidates before building parameters.`,
    );
    this.name = "PreconditionError";
  }
}

class MissingWeightsError extends Error {
  constructor(public readonly missingDimensions: Dimension[]) {
    super(
      `Parameter Builder requires a canonical weight for every dimension; missing: ${missingDimensions.join(", ")}.`,
    );
    this.name = "MissingWeightsError";
  }
}

async function claimCandidatesReadyStatus(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<string | null> {
  const { data, error } = await insforge.database
    .from("ventures")
    .update({ status: IN_PROGRESS_STATUS, error_message: null })
    .eq("id", ventureId)
    .eq("status", PRECONDITION_STATUS)
    .select("id, current_run_id");

  if (error) {
    throw new OrchestratorError(
      `Failed to claim Parameter Builder slot: ${error.message}`,
    );
  }

  const rows =
    (data as unknown as { id: string; current_run_id: string | null }[]) ?? [];
  if (rows.length === 0) {
    const { data: existing } = await insforge.database
      .from("ventures")
      .select("status")
      .eq("id", ventureId)
      .maybeSingle();

    if (!existing) {
      throw new OrchestratorError(
        `Venture not found or inaccessible (id=${ventureId}).`,
      );
    }
    throw new PreconditionError((existing as { status: string }).status);
  }

  return rows[0]!.current_run_id;
}

async function loadParameterInputs(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{
  profileVersion: { id: string; profile: VentureProfile };
  weights: CanonicalWeights;
  candidateGenerationRunId: string;
  priorRuns: PriorParameterRun[];
}> {
  const profile = await loadLatestProfileVersion(insforge, ventureId, [
    "human_refined",
    "llm_extracted",
  ]);

  if (!profile) {
    throw new OrchestratorError(
      "No profile_versions row found for this venture. Stage 1 and HITL refinement must complete before Parameter Builder runs.",
    );
  }

  const [weights, candidateGenerationRunId, priorRuns] = await Promise.all([
    loadCanonicalWeights(insforge, ventureId),
    loadLatestCandidateGenerationRunId(insforge, ventureId),
    loadPriorParameterRuns(insforge, ventureId),
  ]);

  return {
    profileVersion: profile,
    weights,
    candidateGenerationRunId,
    priorRuns,
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

async function loadCanonicalWeights(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<CanonicalWeights> {
  const { data, error } = await insforge.database
    .from("dimension_weights")
    .select("dimension, weight, rationale, source, created_at")
    .eq("venture_id", ventureId);

  if (error) {
    throw new OrchestratorError(
      `Failed to load dimension_weights: ${error.message}`,
    );
  }

  const rows = (data as unknown as DimensionWeightRow[]) ?? [];
  const latestByDimension = new Map<string, DimensionWeightRow>();
  for (const row of rows) {
    const existing = latestByDimension.get(row.dimension);
    if (!existing || row.created_at > existing.created_at) {
      latestByDimension.set(row.dimension, row);
    }
  }

  const missing: Dimension[] = [];
  const weights = {} as CanonicalWeights;
  for (const dim of DIMENSION_KEYS) {
    const row = latestByDimension.get(dim);
    if (!row) {
      missing.push(dim);
      continue;
    }
    weights[dim] = {
      weight: row.weight,
      rationale: row.rationale,
      source: row.source,
    };
  }

  if (missing.length > 0) {
    throw new MissingWeightsError(missing);
  }

  return weights;
}

async function loadLatestCandidateGenerationRunId(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<string> {
  const { data, error } = await insforge.database
    .from("candidate_companies")
    .select("generation_run_id, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new OrchestratorError(
      `Failed to load latest candidate generation run: ${error.message}`,
    );
  }
  if (!data) {
    throw new OrchestratorError(
      "No candidate_companies rows found. Generate candidates before building parameters.",
    );
  }

  return (data as unknown as CandidateRunRow).generation_run_id;
}

interface PriorParameterRun {
  id: string;
  dynamic_parameters: unknown;
  generation_notes: string | null;
  created_at: string;
}

async function loadPriorParameterRuns(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<PriorParameterRun[]> {
  const { data, error } = await insforge.database
    .from("parameter_generation_runs")
    .select("id, dynamic_parameters, generation_notes, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    throw new OrchestratorError(
      `Failed to load prior parameter generations: ${error.message}`,
    );
  }

  return ((data as unknown as ParameterGenerationRunRow[]) ?? []).map((row) => ({
    id: row.id,
    dynamic_parameters: row.dynamic_parameters,
    generation_notes: row.generation_notes,
    created_at: row.created_at,
  }));
}

function assembleParameterPrompt(
  promptBody: string,
  profile: VentureProfile,
  weights: CanonicalWeights,
  priorRuns: PriorParameterRun[],
): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();

  const weightsForPrompt: Record<
    Dimension,
    { weight: number; rationale: string | null }
  > = {} as Record<Dimension, { weight: number; rationale: string | null }>;
  for (const dim of DIMENSION_KEYS) {
    weightsForPrompt[dim] = {
      weight: weights[dim].weight,
      rationale: weights[dim].rationale,
    };
  }

  return [
    stripped,
    "",
    "## VentureX profile (JSON)",
    "",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    "## Canonical dimension weights",
    "",
    "```json",
    JSON.stringify(weightsForPrompt, null, 2),
    "```",
    "",
    "## Prior parameter generations",
    "",
    "Use only as reference. The current profile remains the source of truth.",
    "",
    "```json",
    JSON.stringify(priorRuns, null, 2),
    "```",
    "",
  ].join("\n");
}

async function insertParameterRun(
  insforge: InsForgeClient,
  args: {
    ventureId: string;
    profileVersionId: string;
    candidateGenerationRunId: string;
    llmCallId: string;
    dynamicParameters: DynamicParameter[];
    fullParameterSchema: Parameter[];
    generationNotes: string | null;
  },
): Promise<string> {
  const { data, error } = await insforge.database
    .from("parameter_generation_runs")
    .insert([
      {
        venture_id: args.ventureId,
        profile_version_id: args.profileVersionId,
        candidate_generation_run_id: args.candidateGenerationRunId,
        llm_call_id: args.llmCallId,
        dynamic_parameters: args.dynamicParameters,
        full_parameter_schema: args.fullParameterSchema,
        generation_notes: args.generationNotes,
      },
    ])
    .select("id")
    .single();

  if (error || !data) {
    throw new OrchestratorError(
      `Failed to insert parameter_generation_runs row: ${error?.message ?? "no row returned"}`,
    );
  }

  return (data as InsertedParameterRun).id;
}

async function markParametersReady(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<void> {
  const { error } = await insforge.database
    .from("ventures")
    .update({ status: SUCCESS_STATUS, error_message: null })
    .eq("id", ventureId);

  if (error) {
    throw new OrchestratorError(
      `Failed to transition venture to status='${SUCCESS_STATUS}': ${error.message}`,
    );
  }
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof PreconditionError) return err.message;
  if (err instanceof MissingWeightsError) return err.message;
  if (err instanceof ParameterValidationError) {
    return `Parameter Builder output failed acceptance checks: ${err.message}`;
  }
  if (err instanceof TokenLimitError) {
    return `Parameter Builder input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}).`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted before Parameter Builder could complete: $${err.currentCostUsd.toFixed(4)} already spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}.`;
  }
  if (err instanceof LLMValidationError) {
    return `Parameter Builder model output failed validation after ${err.attempts} attempt(s).`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Parameter Builder OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof OrchestratorError) return err.message;
  return errorMessage(err);
}
