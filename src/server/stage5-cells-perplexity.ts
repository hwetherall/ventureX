import type { InsForgeClient } from "@/lib/insforge/server";
import {
  perplexityBudgetFromEnvironment,
  perplexityCellReservationFromEnvironment,
} from "@/lib/research/budget";
import {
  candidateDomainsFromCitations,
  uniqueAliases,
} from "@/lib/research/identity";
import { researchOneCellWithDeepRepair } from "@/lib/research/orchestrator";
import {
  completeResearchRun,
  createResearchRun,
  failResearchRun,
  markResearchRunRunning,
  persistResearchOutcome,
  providerConfigurationSnapshot,
} from "@/lib/research/persistence";
import { getResearchPolicy } from "@/lib/research/policies";
import { BrightDataContentProvider } from "@/lib/research/providers/bright-data";
import { ExaContentsProvider } from "@/lib/research/providers/exa-contents";
import { PerplexityDeepResearchProvider } from "@/lib/research/providers/perplexity";
import {
  EvidenceDispositionSchema,
  ResearchConfidenceSchema,
  ResearchProviderNameSchema,
  SourceClassSchema,
  VerificationOutcomeSchema,
  type CandidateIdentity,
  type ResearchCellOutcome,
  type ResearchConfidence,
  type ResearchEvidence,
} from "@/lib/research/types";
import { selectPocResearchParameters } from "@/lib/poc-scope";
import {
  ParameterSchema,
  ParameterTierSchema,
  type Parameter,
} from "@/types/parameter";

export interface PerplexityEscalationTarget {
  candidateId: string;
  parameterKey: string;
}

export interface RunPerplexityPostPassInput {
  ventureId: string;
  sourceRunId: string;
  targets: PerplexityEscalationTarget[];
  insforge: InsForgeClient;
  asOf?: string;
  productHint?: string;
  onProgress?: (message: string) => void;
}

export type RunPerplexityPostPassResult =
  | {
      ok: true;
      runId: string;
      sourceRunId: string;
      outcomes: ResearchCellOutcome[];
      incrementalCostUsd: number;
      totalCostUsd: number;
      metrics: Record<string, unknown>;
    }
  | {
      ok: false;
      runId: string | null;
      sourceRunId: string;
      error: string;
      incrementalCostUsd: number;
      totalCostUsd: number;
    };

interface SourceRunRow {
  id: string;
  venture_id: string;
  pipeline_version: string;
  status: string;
  provider_config: Record<string, unknown> | null;
  candidate_ids: unknown;
  parameter_keys: unknown;
  actual_cost_usd: number | string | null;
  metrics: Record<string, unknown> | null;
  completed_at: string | null;
}

interface CandidateRow {
  id: string;
  name: string;
  rationale: string;
  citations: unknown;
}

export async function runPerplexityCellResearchPostPass(
  input: RunPerplexityPostPassInput,
): Promise<RunPerplexityPostPassResult> {
  const budget = perplexityBudgetFromEnvironment();
  const reservationUsd = perplexityCellReservationFromEnvironment();
  let runId: string | null = null;
  let firstPassCostUsd = 0;

  try {
    const deepProvider = new PerplexityDeepResearchProvider();
    if (!deepProvider.enabled) {
      throw new Error(
        "Perplexity post-pass is not enabled. Set PERPLEXITY_API_KEY and explicitly run with CELL_RESEARCH_PERPLEXITY_ENABLED=true.",
      );
    }
    const targets = validateTargets(input.targets);
    const source = await loadSourceRun(
      input.insforge,
      input.ventureId,
      input.sourceRunId,
    );
    firstPassCostUsd = Number(source.actual_cost_usd ?? 0);
    const sourceOutcomes = await loadSourceOutcomes(input.insforge, source.id);
    const outcomeByPair = new Map(
      sourceOutcomes.map((outcome) => [pairKey(outcome), outcome]),
    );
    for (const target of targets) {
      const outcome = outcomeByPair.get(pairKey(target));
      if (!outcome) {
        throw new Error(
          `Approved Perplexity target ${pairKey(target)} is absent from source run ${source.id}.`,
        );
      }
      if (outcome.finalConfidence !== "unknown") {
        throw new Error(
          `Approved Perplexity target ${pairKey(target)} is ${outcome.finalConfidence}, not unknown; refusing unnecessary spend.`,
        );
      }
    }

    const candidateIds = stringArray(source.candidate_ids, "candidate_ids");
    const parameterKeys = stringArray(source.parameter_keys, "parameter_keys");
    const [identities, parameters] = await Promise.all([
      loadCandidateIdentities(input.insforge, input.ventureId, candidateIds),
      loadParameterDefinitions(input.insforge, input.ventureId, parameterKeys),
    ]);
    const identityById = new Map(
      identities.map((identity) => [identity.candidateId, identity]),
    );
    const parameterById = new Map(
      parameters.map((parameter) => [parameter.id, parameter]),
    );
    for (const target of targets) {
      if (!identityById.has(target.candidateId)) {
        throw new Error(`Unknown target candidate ${target.candidateId}.`);
      }
      if (!parameterById.has(target.parameterKey)) {
        throw new Error(`Unknown target parameter ${target.parameterKey}.`);
      }
    }
    const asOf = normalizeAsOf(
      input.asOf ?? source.completed_at ?? new Date().toISOString(),
    );
    runId = await createResearchRun(input.insforge, {
      ventureId: input.ventureId,
      pipelineVersion: "v2_policy_routed",
      candidateIds,
      parameterKeys,
      providerConfig: {
        ...providerConfigurationSnapshot(),
        phase: "perplexity_post_pass",
        source_run_id: source.id,
        source_provider_config: source.provider_config ?? {},
        approved_target_pairs: targets.map(pairKey),
        canonical_cells_mutated: false,
        as_of: asOf,
      },
      predictedCostUsd: firstPassCostUsd + budget.softCapUsd,
    });
    await markResearchRunRunning(input.insforge, runId);
    input.onProgress?.(
      `Created post-pass run ${runId}; cloning ${sourceOutcomes.length} first-pass cells.`,
    );
    for (const outcome of sourceOutcomes) {
      await persistResearchOutcome({
        insforge: input.insforge,
        runId,
        outcome: { ...outcome, attempts: [] },
      });
    }
    await cloneProviderCalls(input.insforge, source.id, runId);

    const primaryContent = new ExaContentsProvider();
    const fallbackContent = new BrightDataContentProvider();
    const transitions: Array<Record<string, unknown>> = [];
    for (const [index, target] of targets.entries()) {
      const identity = identityById.get(target.candidateId)!;
      const parameter = parameterById.get(target.parameterKey)!;
      const existing = outcomeByPair.get(pairKey(target))!;
      input.onProgress?.(
        `[${index + 1}/${targets.length}] Escalating ${identity.name} · ${parameter.name}`,
      );
      const repaired = await researchOneCellWithDeepRepair({
        insforge: input.insforge,
        ventureId: input.ventureId,
        candidate: identity,
        parameter,
        policy: getResearchPolicy(parameter),
        existing,
        deepProvider,
        primaryContent,
        fallbackContent,
        budget,
        cellReservationUsd: reservationUsd,
        asOf,
        productHint:
          input.productHint ??
          "rack PDU and rack-level data-center power distribution",
      });
      await replaceResearchOutcome({
        insforge: input.insforge,
        runId,
        outcome: repaired,
      });
      outcomeByPair.set(pairKey(target), repaired);
      transitions.push({
        candidate_id: target.candidateId,
        candidate: identity.name,
        parameter_key: target.parameterKey,
        parameter: parameter.name,
        before: existing.finalConfidence,
        after: repaired.finalConfidence,
        incremental_cost_usd: repaired.costUsd - existing.costUsd,
        value: repaired.value,
        reason: repaired.reason,
      });
      input.onProgress?.(
        `[${index + 1}/${targets.length}] ${identity.name} · ${parameter.name}: ${existing.finalConfidence} -> ${repaired.finalConfidence}; incremental spend $${budget.spentUsd.toFixed(4)}`,
      );
    }

    const totalCostUsd = firstPassCostUsd + budget.spentUsd;
    const outcomes = [...outcomeByPair.values()];
    const metrics = await computePostPassMetrics({
      insforge: input.insforge,
      runId,
      source,
      transitions,
      budget: budget.snapshot(),
      firstPassCostUsd,
      totalCostUsd,
    });
    await completeResearchRun({
      insforge: input.insforge,
      runId,
      costUsd: totalCostUsd,
      metrics,
    });
    return {
      ok: true,
      runId,
      sourceRunId: source.id,
      outcomes,
      incrementalCostUsd: budget.spentUsd,
      totalCostUsd,
      metrics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await failResearchRun({
        insforge: input.insforge,
        runId,
        costUsd: firstPassCostUsd + budget.spentUsd,
        errorMessage: message,
      });
    }
    return {
      ok: false,
      runId,
      sourceRunId: input.sourceRunId,
      error: message,
      incrementalCostUsd: budget.spentUsd,
      totalCostUsd: firstPassCostUsd + budget.spentUsd,
    };
  }
}

function validateTargets(
  targets: PerplexityEscalationTarget[],
): PerplexityEscalationTarget[] {
  const maxTargets = positiveInteger(
    process.env.CELL_RESEARCH_PERPLEXITY_MAX_CELLS,
    7,
  );
  if (targets.length === 0) {
    throw new Error(
      "Perplexity post-pass requires an explicit target allowlist.",
    );
  }
  if (targets.length > maxTargets) {
    throw new Error(
      `Perplexity post-pass received ${targets.length} cells; the explicit cap is ${maxTargets}.`,
    );
  }
  const seen = new Set<string>();
  return targets.map((target) => {
    if (!target.candidateId || !target.parameterKey) {
      throw new Error(
        "Each Perplexity target requires candidateId and parameterKey.",
      );
    }
    const key = pairKey(target);
    if (seen.has(key)) throw new Error(`Duplicate Perplexity target ${key}.`);
    seen.add(key);
    return target;
  });
}

async function loadSourceRun(
  insforge: InsForgeClient,
  ventureId: string,
  runId: string,
): Promise<SourceRunRow> {
  const { data, error } = await insforge.database
    .from("cell_research_runs")
    .select(
      "id, venture_id, pipeline_version, status, provider_config, candidate_ids, parameter_keys, actual_cost_usd, metrics, completed_at",
    )
    .eq("id", runId)
    .eq("venture_id", ventureId)
    .single();
  if (error || !data) {
    throw new Error(
      `Cannot load source research run ${runId}: ${error?.message ?? "not found"}`,
    );
  }
  const row = data as SourceRunRow;
  if (row.pipeline_version !== "v2_policy_routed") {
    throw new Error(`Source run ${runId} is not policy-routed V2.`);
  }
  if (row.status !== "completed") {
    throw new Error(
      `Source run ${runId} must be completed before Perplexity escalation; status is ${row.status}.`,
    );
  }
  return row;
}

async function loadSourceOutcomes(
  insforge: InsForgeClient,
  runId: string,
): Promise<ResearchCellOutcome[]> {
  const { data, error } = await insforge.database
    .from("cell_research_results")
    .select(
      "id, candidate_id, parameter_key, tier, value, proposed_confidence, final_confidence, reason, verifier_outcome, cost_usd, latency_ms",
    )
    .eq("run_id", runId);
  if (error)
    throw new Error(`Failed to load source outcomes: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  if (rows.length === 0)
    throw new Error(`Source run ${runId} has no outcomes.`);
  const evidenceByResult = await loadEvidence(
    insforge,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    candidateId: String(row.candidate_id),
    parameterKey: String(row.parameter_key),
    tier: ParameterTierSchema.parse(row.tier),
    value: row.value ?? null,
    proposedConfidence: ResearchConfidenceSchema.parse(row.proposed_confidence),
    finalConfidence: ResearchConfidenceSchema.parse(row.final_confidence),
    reason: typeof row.reason === "string" ? row.reason : null,
    verification: row.verifier_outcome
      ? VerificationOutcomeSchema.parse(row.verifier_outcome)
      : null,
    evidence: evidenceByResult.get(row.id) ?? [],
    attempts: [],
    costUsd: Number(row.cost_usd ?? 0),
    latencyMs: Number(row.latency_ms ?? 0),
  }));
}

async function loadEvidence(
  insforge: InsForgeClient,
  resultIds: string[],
): Promise<Map<string, ResearchEvidence[]>> {
  const { data, error } = await insforge.database
    .from("cell_evidence")
    .select(
      "result_id, provider, provider_request_id, url, canonical_url, title, source_domain, source_class, excerpt, published_at, effective_at, retrieved_at, search_query, result_rank, content_hash, candidate_match, disposition, supported_value_paths, verifier_reason",
    )
    .in("result_id", resultIds);
  if (error)
    throw new Error(`Failed to load source evidence: ${error.message}`);
  const out = new Map<string, ResearchEvidence[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const resultId = String(row.result_id);
    const item: ResearchEvidence = {
      provider: ResearchProviderNameSchema.parse(row.provider),
      providerRequestId:
        typeof row.provider_request_id === "string"
          ? row.provider_request_id
          : null,
      url: String(row.url),
      canonicalUrl: String(row.canonical_url),
      title: String(row.title ?? ""),
      sourceDomain: String(row.source_domain),
      sourceClass: SourceClassSchema.parse(row.source_class),
      excerpt: String(row.excerpt ?? ""),
      publishedAt:
        typeof row.published_at === "string" ? row.published_at : null,
      effectiveAt:
        typeof row.effective_at === "string" ? row.effective_at : null,
      retrievedAt: String(row.retrieved_at),
      searchQuery:
        typeof row.search_query === "string" ? row.search_query : null,
      resultRank: typeof row.result_rank === "number" ? row.result_rank : null,
      contentHash:
        typeof row.content_hash === "string" ? row.content_hash : null,
      candidateMatch:
        typeof row.candidate_match === "boolean" ? row.candidate_match : null,
      disposition: EvidenceDispositionSchema.parse(row.disposition),
      supportedValuePaths: Array.isArray(row.supported_value_paths)
        ? row.supported_value_paths.map(String)
        : [],
      verifierReason:
        typeof row.verifier_reason === "string" ? row.verifier_reason : null,
    };
    out.set(resultId, [...(out.get(resultId) ?? []), item]);
  }
  return out;
}

async function loadCandidateIdentities(
  insforge: InsForgeClient,
  ventureId: string,
  candidateIds: string[],
): Promise<CandidateIdentity[]> {
  const [{ data, error }, legalNames] = await Promise.all([
    insforge.database
      .from("candidate_companies")
      .select("id, name, rationale, citations")
      .eq("venture_id", ventureId)
      .in("id", candidateIds),
    loadCanonicalLegalNames(insforge, candidateIds),
  ]);
  if (error) throw new Error(`Failed to load candidates: ${error.message}`);
  const rows = (data ?? []) as CandidateRow[];
  if (rows.length !== candidateIds.length) {
    throw new Error(
      `Source run has ${candidateIds.length} candidate IDs but only ${rows.length} candidates are available.`,
    );
  }
  const order = new Map(candidateIds.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return rows.map((candidate) => {
    const legalName = legalNames.get(candidate.id) ?? null;
    return {
      candidateId: candidate.id,
      name: candidate.name,
      legalName,
      aliases: uniqueAliases([candidate.name, legalName]),
      domains: candidateDomainsFromCitations(candidate.citations),
      countryCode: null,
    };
  });
}

async function loadCanonicalLegalNames(
  insforge: InsForgeClient,
  candidateIds: string[],
): Promise<Map<string, string>> {
  const { data } = await insforge.database
    .from("cells")
    .select("candidate_id, value")
    .eq("parameter_key", "legal_name")
    .in("candidate_id", candidateIds);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as Array<{
    candidate_id: string;
    value: unknown;
  }>) {
    if (typeof row.value === "string") out.set(row.candidate_id, row.value);
  }
  return out;
}

async function loadParameterDefinitions(
  insforge: InsForgeClient,
  ventureId: string,
  parameterKeys: string[],
): Promise<Parameter[]> {
  const { data, error } = await insforge.database
    .from("parameter_generation_runs")
    .select("full_parameter_schema")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to load parameter definitions: ${error?.message ?? "no row"}`,
    );
  }
  const raw = (data as { full_parameter_schema: unknown })
    .full_parameter_schema;
  if (!Array.isArray(raw))
    throw new Error("Stored parameter schema is not an array.");
  const selected = selectPocResearchParameters(
    raw.map((item) => ParameterSchema.parse(item)),
  );
  const byId = new Map(selected.map((parameter) => [parameter.id, parameter]));
  return parameterKeys.map((key) => {
    const parameter = byId.get(key);
    if (!parameter) {
      throw new Error(
        `Source parameter ${key} is not in the current PoC schema.`,
      );
    }
    return parameter;
  });
}

async function cloneProviderCalls(
  insforge: InsForgeClient,
  sourceRunId: string,
  targetRunId: string,
): Promise<void> {
  const { data, error } = await insforge.database
    .from("research_provider_calls")
    .select(
      "candidate_id, parameter_key, provider, operation, query, request_metadata, response_metadata, result_count, cost_usd, latency_ms, error",
    )
    .eq("run_id", sourceRunId);
  if (error)
    throw new Error(`Failed to clone provider audit: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  for (let offset = 0; offset < rows.length; offset += 150) {
    const batch = rows.slice(offset, offset + 150).map((row) => ({
      run_id: targetRunId,
      candidate_id: row.candidate_id ?? null,
      parameter_key: row.parameter_key ?? null,
      provider: row.provider,
      operation: row.operation,
      query: row.query ?? null,
      request_metadata: row.request_metadata ?? {},
      response_metadata: row.response_metadata ?? {},
      result_count: row.result_count ?? null,
      cost_usd: Number(row.cost_usd ?? 0),
      latency_ms: Number(row.latency_ms ?? 0),
      error: row.error ?? null,
    }));
    const { error: insertError } = await insforge.database
      .from("research_provider_calls")
      .insert(batch);
    if (insertError) {
      throw new Error(
        `Failed to persist cloned provider audit: ${insertError.message}`,
      );
    }
  }
}

async function replaceResearchOutcome(args: {
  insforge: InsForgeClient;
  runId: string;
  outcome: ResearchCellOutcome;
}): Promise<void> {
  const { error } = await args.insforge.database
    .from("cell_research_results")
    .delete()
    .eq("run_id", args.runId)
    .eq("candidate_id", args.outcome.candidateId)
    .eq("parameter_key", args.outcome.parameterKey);
  if (error)
    throw new Error(`Failed to replace cloned result: ${error.message}`);
  await persistResearchOutcome(args);
}

async function computePostPassMetrics(args: {
  insforge: InsForgeClient;
  runId: string;
  source: SourceRunRow;
  transitions: Array<Record<string, unknown>>;
  budget: ReturnType<
    ReturnType<typeof perplexityBudgetFromEnvironment>["snapshot"]
  >;
  firstPassCostUsd: number;
  totalCostUsd: number;
}): Promise<Record<string, unknown>> {
  const [resultsResponse, callsResponse, evidenceResponse] = await Promise.all([
    args.insforge.database
      .from("cell_research_results")
      .select("id, final_confidence, reason")
      .eq("run_id", args.runId),
    args.insforge.database
      .from("research_provider_calls")
      .select("provider, operation")
      .eq("run_id", args.runId),
    args.insforge.database
      .from("cell_evidence")
      .select("result_id, cell_research_results!inner(run_id)")
      .eq("cell_research_results.run_id", args.runId),
  ]);
  if (resultsResponse.error) throw new Error(resultsResponse.error.message);
  if (callsResponse.error) throw new Error(callsResponse.error.message);
  if (evidenceResponse.error) throw new Error(evidenceResponse.error.message);
  const results = (resultsResponse.data ?? []) as Array<{
    id: string;
    final_confidence: ResearchConfidence;
    reason: string | null;
  }>;
  const evidenced = new Set(
    ((evidenceResponse.data ?? []) as Array<{ result_id: string }>).map(
      (row) => row.result_id,
    ),
  );
  const providerCounts = new Map<string, number>();
  const operationCounts = new Map<string, number>();
  for (const row of (callsResponse.data ?? []) as Array<{
    provider: string;
    operation: string;
  }>) {
    providerCounts.set(
      row.provider,
      (providerCounts.get(row.provider) ?? 0) + 1,
    );
    operationCounts.set(
      row.operation,
      (operationCounts.get(row.operation) ?? 0) + 1,
    );
  }
  const confidence = (value: ResearchConfidence) =>
    results.filter((row) => row.final_confidence === value).length;
  return {
    phase: "perplexity_post_pass",
    source_run_id: args.source.id,
    source_metrics: args.source.metrics ?? {},
    cells: results.length,
    verified: confidence("verified"),
    inferred: confidence("inferred"),
    unknown: confidence("unknown"),
    with_evidence: evidenced.size,
    cell_errors: results.filter((row) => row.reason?.startsWith("cell_error:"))
      .length,
    provider_calls: Object.fromEntries(providerCounts),
    provider_operations: Object.fromEntries(operationCounts),
    target_transitions: args.transitions,
    targets_improved: args.transitions.filter(
      (item) => item.before === "unknown" && item.after !== "unknown",
    ).length,
    budget: {
      ...args.budget,
      firstPassCostUsd: args.firstPassCostUsd,
      incrementalSpentUsd: args.budget.spentUsd,
      totalSpentUsd: args.totalCostUsd,
    },
    canonical_cells_mutated: false,
  };
}

function pairKey(value: { candidateId: string; parameterKey: string }): string {
  return `${value.candidateId}:${value.parameterKey}`;
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`Source run ${label} is not a string array.`);
  }
  return value;
}

function normalizeAsOf(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp))
    throw new Error(`Invalid post-pass as-of date: ${value}`);
  return new Date(timestamp).toISOString();
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
