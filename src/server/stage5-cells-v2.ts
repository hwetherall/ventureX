import { randomUUID } from "node:crypto";

import type { InsForgeClient } from "@/lib/insforge/server";
import { researchBudgetFromEnvironment } from "@/lib/research/budget";
import { ResearchBudgetError } from "@/lib/research/errors";
import {
  candidateDomainsFromCitations,
  uniqueAliases,
} from "@/lib/research/identity";
import { researchOneCell } from "@/lib/research/orchestrator";
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
import { BraveSearchProvider } from "@/lib/research/providers/brave";
import { ExaContentsProvider } from "@/lib/research/providers/exa-contents";
import { ExaSearchProvider } from "@/lib/research/providers/exa-search";
import { CompaniesHouseProvider } from "@/lib/research/providers/official/companies-house";
import { GleifProvider } from "@/lib/research/providers/official/gleif";
import { SecEdgarProvider } from "@/lib/research/providers/official/sec-edgar";
import type {
  CandidateIdentity,
  ResearchCellOutcome,
  ResearchConfidence,
} from "@/lib/research/types";
import { POC_CANDIDATE_COUNT, POC_PARAMETER_COUNT, selectPocResearchParameters } from "@/lib/poc-scope";
import { ParameterSchema, type Parameter } from "@/types/parameter";

interface CandidateRow {
  id: string;
  name: string;
  rationale: string;
  citations: unknown;
}

interface ParameterRunRow {
  full_parameter_schema: unknown;
}

export interface RunStage5V2Input {
  ventureId: string;
  insforge: InsForgeClient;
  candidateIds?: string[];
  asOf?: string;
  productHint?: string;
  concurrency?: number;
  /** False runs the pipeline without V2 persistence; LLM audit logs still apply. */
  persist?: boolean;
  /** Reopen this V2 run and research only results whose reason starts with cell_error:. */
  resumeRunId?: string;
  /** Explicit candidateId:parameterKey pairs to replace during a resumed run. */
  retryCellKeys?: string[];
}

export type RunStage5V2Result =
  | {
      ok: true;
      runId: string;
      persisted: boolean;
      outcomes: ResearchCellOutcome[];
      costUsd: number;
      latencyMs: number;
      metrics: Record<string, unknown>;
    }
  | { ok: false; runId: string | null; error: string; costUsd: number };

export async function finalizeStage5CellResearchV2Run(args: {
  insforge: InsForgeClient;
  runId: string;
  totalCostUsd: number;
}): Promise<Record<string, unknown>> {
  const budget = researchBudgetFromEnvironment();
  const metrics = await computePersistedMetrics(
    args.insforge,
    args.runId,
    budget.snapshot(),
    args.totalCostUsd,
  );
  await completeResearchRun({
    insforge: args.insforge,
    runId: args.runId,
    costUsd: args.totalCostUsd,
    metrics,
  });
  return metrics;
}

export async function runStage5CellResearchV2(
  input: RunStage5V2Input,
): Promise<RunStage5V2Result> {
  const started = Date.now();
  const persist = input.persist !== false;
  const asOf = normalizeAsOf(input.asOf ?? new Date().toISOString());
  const budget = researchBudgetFromEnvironment();
  let runId: string | null = null;
  let priorCostUsd = 0;

  try {
    const candidates = await loadCandidates(
      input.insforge,
      input.ventureId,
      input.candidateIds,
    );
    if (candidates.length !== POC_CANDIDATE_COUNT) {
      throw new Error(
        `V2 3×10 requires exactly ${POC_CANDIDATE_COUNT} candidates; found ${candidates.length}.`,
      );
    }
    const parameters = await loadPocParameters(input.insforge, input.ventureId);
    if (parameters.length !== POC_PARAMETER_COUNT) {
      throw new Error(
        `V2 3×10 requires exactly ${POC_PARAMETER_COUNT} parameters; found ${parameters.length}.`,
      );
    }
    const legalNames = await loadCanonicalLegalNames(
      input.insforge,
      candidates.map((candidate) => candidate.id),
    );
    const identities = candidates.map((candidate) =>
      makeIdentity(candidate, legalNames.get(candidate.id) ?? null),
    );
    if (input.resumeRunId && !persist) {
      throw new Error("V2 error-only resume requires persistence");
    }
    if (input.resumeRunId) {
      const resumed = await loadResearchRunForResume(
        input.insforge,
        input.ventureId,
        input.resumeRunId,
      );
      runId = resumed.id;
      priorCostUsd = resumed.actualCostUsd;
    } else {
      runId = persist
        ? await createResearchRun(input.insforge, {
            ventureId: input.ventureId,
            pipelineVersion: "v2_policy_routed",
            candidateIds: candidates.map((candidate) => candidate.id),
            parameterKeys: parameters.map((parameter) => parameter.id),
            providerConfig: providerConfigurationSnapshot(),
            predictedCostUsd: budget.softCapUsd,
          })
        : randomUUID();
    }
    if (persist) await markResearchRunRunning(input.insforge, runId);

    const providers = {
      search: [new ExaSearchProvider(), new BraveSearchProvider()],
      primaryContent: new ExaContentsProvider(),
      fallbackContent: new BrightDataContentProvider(),
      official: [
        new GleifProvider(),
        new SecEdgarProvider(),
        new CompaniesHouseProvider(),
      ],
    };
    let jobs = identities.flatMap((candidate) =>
      parameters.map((parameter) => ({ candidate, parameter })),
    );
    if (input.resumeRunId) {
      const retryPairs = input.retryCellKeys?.length
        ? new Set(input.retryCellKeys)
        : await loadErroredCellPairs(input.insforge, runId);
      jobs = jobs.filter((job) =>
        retryPairs.has(
          `${job.candidate.candidateId}:${job.parameter.id}`,
        ),
      );
      if (jobs.length === 0) {
        throw new Error(`V2 run ${runId} has no matching results to retry`);
      }
    }
    const limiter = createConcurrencyLimiter(
      Math.max(1, Math.min(input.concurrency ?? 2, 4)),
    );
    const outcomes = await Promise.all(
      jobs.map((job) =>
        limiter(async () => {
          try {
            const outcome = await researchOneCell({
              insforge: input.insforge,
              runId: runId!,
              ventureId: input.ventureId,
              candidate: job.candidate,
              parameter: job.parameter,
              policy: getResearchPolicy(job.parameter),
              providers,
              budget,
              asOf,
              productHint: input.productHint,
            });
            if (persist) {
              if (input.resumeRunId) {
                await deleteResearchOutcome({
                  insforge: input.insforge,
                  runId: runId!,
                  candidateId: job.candidate.candidateId,
                  parameterKey: job.parameter.id,
                });
              }
              await persistResearchOutcome({
                insforge: input.insforge,
                runId: runId!,
                outcome,
              });
            }
            return outcome;
          } catch (error) {
            if (error instanceof ResearchBudgetError) throw error;
            const outcome = failedCellOutcome(
              job.candidate,
              job.parameter,
              error,
            );
            if (persist) {
              if (input.resumeRunId) {
                await deleteResearchOutcome({
                  insforge: input.insforge,
                  runId: runId!,
                  candidateId: job.candidate.candidateId,
                  parameterKey: job.parameter.id,
                });
              }
              await persistResearchOutcome({
                insforge: input.insforge,
                runId: runId!,
                outcome,
              });
            }
            return outcome;
          }
        }),
      ),
    );
    const totalCostUsd = priorCostUsd + budget.spentUsd;
    const metrics = persist
      ? await computePersistedMetrics(
          input.insforge,
          runId,
          budget.snapshot(),
          totalCostUsd,
        )
      : computeMetrics(outcomes, budget.snapshot());
    if (persist) {
      await completeResearchRun({
        insforge: input.insforge,
        runId,
        costUsd: totalCostUsd,
        metrics,
      });
    }
    return {
      ok: true,
      runId,
      persisted: persist,
      outcomes,
      costUsd: totalCostUsd,
      latencyMs: Date.now() - started,
      metrics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (persist && runId) {
      await failResearchRun({
        insforge: input.insforge,
        runId,
        costUsd: priorCostUsd + budget.spentUsd,
        errorMessage: message,
      });
    }
    return {
      ok: false,
      runId,
      error: message,
      costUsd: priorCostUsd + budget.spentUsd,
    };
  }
}

async function loadResearchRunForResume(
  insforge: InsForgeClient,
  ventureId: string,
  runId: string,
): Promise<{ id: string; actualCostUsd: number }> {
  const { data, error } = await insforge.database
    .from("cell_research_runs")
    .select("id, pipeline_version, actual_cost_usd")
    .eq("id", runId)
    .eq("venture_id", ventureId)
    .single();
  if (error || !data) {
    throw new Error(
      `Cannot resume V2 run ${runId}: ${error?.message ?? "not found"}`,
    );
  }
  const row = data as {
    id: string;
    pipeline_version: string;
    actual_cost_usd: number | string | null;
  };
  if (row.pipeline_version !== "v2_policy_routed") {
    throw new Error(`Run ${runId} is not a V2 policy-routed run`);
  }
  return { id: row.id, actualCostUsd: Number(row.actual_cost_usd ?? 0) };
}

async function loadErroredCellPairs(
  insforge: InsForgeClient,
  runId: string,
): Promise<Set<string>> {
  const { data, error } = await insforge.database
    .from("cell_research_results")
    .select("candidate_id, parameter_key, reason")
    .eq("run_id", runId);
  if (error) throw new Error(`Failed to load retryable cells: ${error.message}`);
  return new Set(
    ((data ?? []) as Array<{
      candidate_id: string;
      parameter_key: string;
      reason: string | null;
    }>)
      .filter((row) => row.reason?.startsWith("cell_error:"))
      .map((row) => `${row.candidate_id}:${row.parameter_key}`),
  );
}

async function deleteResearchOutcome(args: {
  insforge: InsForgeClient;
  runId: string;
  candidateId: string;
  parameterKey: string;
}): Promise<void> {
  const { error } = await args.insforge.database
    .from("cell_research_results")
    .delete()
    .eq("run_id", args.runId)
    .eq("candidate_id", args.candidateId)
    .eq("parameter_key", args.parameterKey);
  if (error) throw new Error(`Failed to replace errored V2 result: ${error.message}`);
}

async function loadCandidates(
  insforge: InsForgeClient,
  ventureId: string,
  candidateIds?: string[],
): Promise<CandidateRow[]> {
  let query = insforge.database
    .from("candidate_companies")
    .select("id, name, rationale, citations")
    .eq("venture_id", ventureId);
  if (candidateIds?.length) query = query.in("id", candidateIds);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load V2 candidates: ${error.message}`);
  const rows = (data ?? []) as CandidateRow[];
  if (candidateIds?.length) {
    const order = new Map(candidateIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }
  return rows;
}

async function loadPocParameters(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<Parameter[]> {
  const { data, error } = await insforge.database
    .from("parameter_generation_runs")
    .select("full_parameter_schema, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to load V2 parameter schema: ${error?.message ?? "no row"}`,
    );
  }
  const raw = (data as ParameterRunRow).full_parameter_schema;
  if (!Array.isArray(raw)) throw new Error("Stored parameter schema is not an array");
  const parsed = raw.map((item) => ParameterSchema.parse(item));
  return selectPocResearchParameters(parsed);
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

function makeIdentity(
  candidate: CandidateRow,
  legalName: string | null,
): CandidateIdentity {
  return {
    candidateId: candidate.id,
    name: candidate.name,
    legalName,
    aliases: uniqueAliases([candidate.name, legalName]),
    domains: candidateDomainsFromCitations(candidate.citations),
    countryCode: null,
  };
}

function failedCellOutcome(
  candidate: CandidateIdentity,
  parameter: Parameter,
  error: unknown,
): ResearchCellOutcome {
  return {
    candidateId: candidate.candidateId,
    parameterKey: parameter.id,
    tier: parameter.tier,
    value: null,
    proposedConfidence: "unknown",
    finalConfidence: "unknown",
    reason: `cell_error: ${(error instanceof Error ? error.message : String(error)).slice(0, 1_500)}`,
    verification: null,
    evidence: [],
    attempts: [],
    costUsd: 0,
    latencyMs: 0,
  };
}

function computeMetrics(
  outcomes: ResearchCellOutcome[],
  budget: ReturnType<ReturnType<typeof researchBudgetFromEnvironment>["snapshot"]>,
): Record<string, unknown> {
  const confidence = (value: ResearchConfidence) =>
    outcomes.filter((outcome) => outcome.finalConfidence === value).length;
  const providerCounts = new Map<string, number>();
  for (const outcome of outcomes) {
    for (const attempt of outcome.attempts) {
      providerCounts.set(
        attempt.provider,
        (providerCounts.get(attempt.provider) ?? 0) + 1,
      );
    }
  }
  return {
    cells: outcomes.length,
    verified: confidence("verified"),
    inferred: confidence("inferred"),
    unknown: confidence("unknown"),
    with_evidence: outcomes.filter((outcome) => outcome.evidence.length > 0)
      .length,
    cell_errors: outcomes.filter((outcome) => outcome.reason?.startsWith("cell_error:"))
      .length,
    provider_calls: Object.fromEntries(providerCounts),
    budget,
  };
}

async function computePersistedMetrics(
  insforge: InsForgeClient,
  runId: string,
  budget: ReturnType<ReturnType<typeof researchBudgetFromEnvironment>["snapshot"]>,
  totalCostUsd: number,
): Promise<Record<string, unknown>> {
  const [resultsResponse, evidenceResponse, callsResponse] = await Promise.all([
    insforge.database
      .from("cell_research_results")
      .select("id, final_confidence, reason")
      .eq("run_id", runId),
    insforge.database
      .from("cell_evidence")
      .select("result_id, cell_research_results!inner(run_id)")
      .eq("cell_research_results.run_id", runId),
    insforge.database
      .from("research_provider_calls")
      .select("provider")
      .eq("run_id", runId),
  ]);
  if (resultsResponse.error) {
    throw new Error(`Failed to summarize V2 results: ${resultsResponse.error.message}`);
  }
  if (evidenceResponse.error) {
    throw new Error(`Failed to summarize V2 evidence: ${evidenceResponse.error.message}`);
  }
  if (callsResponse.error) {
    throw new Error(`Failed to summarize V2 provider calls: ${callsResponse.error.message}`);
  }
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
  for (const row of (callsResponse.data ?? []) as Array<{ provider: string }>) {
    providerCounts.set(row.provider, (providerCounts.get(row.provider) ?? 0) + 1);
  }
  const confidence = (value: ResearchConfidence) =>
    results.filter((row) => row.final_confidence === value).length;
  return {
    cells: results.length,
    verified: confidence("verified"),
    inferred: confidence("inferred"),
    unknown: confidence("unknown"),
    with_evidence: evidenced.size,
    cell_errors: results.filter((row) => row.reason?.startsWith("cell_error:"))
      .length,
    provider_calls: Object.fromEntries(providerCounts),
    budget: {
      ...budget,
      spentUsd: totalCostUsd,
      incrementalSpentUsd: budget.spentUsd,
      isAboveSoftCap: totalCostUsd > budget.softCapUsd,
    },
  };
}

function normalizeAsOf(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`Invalid V2 as-of date: ${value}`);
  return new Date(timestamp).toISOString();
}

function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function <T>(factory: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (active >= maxConcurrent) {
          queue.push(run);
          return;
        }
        active += 1;
        factory()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            queue.shift()?.();
          });
      };
      run();
    });
  };
}
