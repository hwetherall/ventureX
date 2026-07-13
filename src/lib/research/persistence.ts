import type { InsForgeClient } from "@/lib/insforge/server";

import type { ResearchCellOutcome } from "./types";

export interface CreateResearchRunInput {
  ventureId: string;
  pipelineVersion: "v1_snapshot" | "v2_policy_routed";
  candidateIds: string[];
  parameterKeys: string[];
  providerConfig: Record<string, unknown>;
  predictedCostUsd?: number | null;
}

export async function createResearchRun(
  insforge: InsForgeClient,
  input: CreateResearchRunInput,
): Promise<string> {
  const { data, error } = await insforge.database
    .from("cell_research_runs")
    .insert([
      {
        venture_id: input.ventureId,
        pipeline_version: input.pipelineVersion,
        status: "created",
        candidate_ids: input.candidateIds,
        parameter_keys: input.parameterKeys,
        provider_config: input.providerConfig,
        predicted_cost_usd: input.predictedCostUsd ?? null,
      },
    ])
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create cell research run: ${error?.message ?? "no row returned"}`);
  }
  return (data as { id: string }).id;
}

export async function markResearchRunRunning(
  insforge: InsForgeClient,
  runId: string,
): Promise<void> {
  const { error } = await insforge.database
    .from("cell_research_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw new Error(`Failed to start research run: ${error.message}`);
}

export async function completeResearchRun(args: {
  insforge: InsForgeClient;
  runId: string;
  costUsd: number;
  metrics: Record<string, unknown>;
}): Promise<void> {
  await withTransientDatabaseRetry(async () => {
    const { error } = await args.insforge.database
      .from("cell_research_runs")
      .update({
        status: "completed",
        actual_cost_usd: args.costUsd,
        metrics: args.metrics,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", args.runId);
    if (error) {
      throw new Error(`Failed to complete research run: ${error.message}`);
    }
  });
}

export async function failResearchRun(args: {
  insforge: InsForgeClient;
  runId: string;
  costUsd: number;
  errorMessage: string;
}): Promise<void> {
  await args.insforge.database
    .from("cell_research_runs")
    .update({
      status: "failed",
      actual_cost_usd: args.costUsd,
      error: args.errorMessage.slice(0, 2_000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", args.runId);
}

export async function persistResearchOutcome(args: {
  insforge: InsForgeClient;
  runId: string;
  outcome: ResearchCellOutcome;
}): Promise<void> {
  const { data, error } = await args.insforge.database
    .from("cell_research_results")
    .insert([
      {
        run_id: args.runId,
        candidate_id: args.outcome.candidateId,
        parameter_key: args.outcome.parameterKey,
        tier: args.outcome.tier,
        value: args.outcome.value,
        proposed_confidence: args.outcome.proposedConfidence,
        final_confidence: args.outcome.finalConfidence,
        reason: args.outcome.reason,
        verifier_outcome: args.outcome.verification,
        cost_usd: args.outcome.costUsd,
        latency_ms: args.outcome.latencyMs,
      },
    ])
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to persist V2 result ${args.outcome.candidateId}/${args.outcome.parameterKey}: ${error?.message ?? "no row returned"}`,
    );
  }
  const resultId = (data as { id: string }).id;
  if (args.outcome.evidence.length > 0) {
    const { error: evidenceError } = await args.insforge.database
      .from("cell_evidence")
      .insert(
        args.outcome.evidence.map((item) => ({
          result_id: resultId,
          provider: item.provider,
          provider_request_id: item.providerRequestId ?? null,
          url: item.url,
          canonical_url: item.canonicalUrl,
          title: item.title,
          source_domain: item.sourceDomain,
          source_class: item.sourceClass,
          excerpt: item.excerpt,
          published_at: parseTimestamp(item.publishedAt),
          effective_at: item.effectiveAt ?? null,
          retrieved_at: item.retrievedAt,
          search_query: item.searchQuery ?? null,
          result_rank: item.resultRank ?? null,
          content_hash: item.contentHash ?? null,
          candidate_match: item.candidateMatch ?? null,
          disposition: item.disposition,
          supported_value_paths: item.supportedValuePaths,
          verifier_reason: item.verifierReason ?? null,
        })),
      );
    if (evidenceError) {
      throw new Error(`Failed to persist cell evidence: ${evidenceError.message}`);
    }
  }
  if (args.outcome.attempts.length > 0) {
    const { error: attemptsError } = await args.insforge.database
      .from("research_provider_calls")
      .insert(
        args.outcome.attempts.map((attempt) => ({
          run_id: args.runId,
          candidate_id: args.outcome.candidateId,
          parameter_key: args.outcome.parameterKey,
          provider: attempt.provider,
          operation: attempt.operation,
          query: attempt.query ?? null,
          request_metadata: attempt.requestMetadata,
          response_metadata: attempt.responseMetadata,
          result_count: attempt.resultCount ?? null,
          cost_usd: attempt.costUsd,
          latency_ms: attempt.latencyMs,
          error: attempt.error ?? null,
        })),
      );
    if (attemptsError) {
      throw new Error(
        `Failed to persist provider call audit: ${attemptsError.message}`,
      );
    }
  }
}

export async function promoteResearchRun(args: {
  insforge: InsForgeClient;
  runId: string;
  confirmPromotion: true;
}): Promise<number> {
  if (args.confirmPromotion !== true) {
    throw new Error("Explicit promotion confirmation is required");
  }
  const { data, error } = await args.insforge.database
    .from("cell_research_results")
    .select(
      "candidate_id, parameter_key, tier, value, final_confidence, reason, created_at",
    )
    .eq("run_id", args.runId);
  if (error) throw new Error(`Failed to read promotable results: ${error.message}`);
  const rows = (data ?? []) as Array<{
    candidate_id: string;
    parameter_key: string;
    tier: string;
    value: unknown;
    final_confidence: string;
    reason: string | null;
    created_at: string;
  }>;
  for (const row of rows) {
    const { data: evidence } = await args.insforge.database
      .from("cell_evidence")
      .select("url, title, excerpt, retrieved_at, disposition")
      .eq("result_id", await resultIdFor(args.insforge, args.runId, row));
    const best = (evidence ?? []).find(
      (item: { disposition: string }) => item.disposition === "direct",
    ) as
      | {
          url: string;
          title: string;
          excerpt: string;
          retrieved_at: string;
        }
      | undefined;
    await args.insforge.database
      .from("cells")
      .delete()
      .eq("candidate_id", row.candidate_id)
      .eq("parameter_key", row.parameter_key);
    const { error: insertError } = await args.insforge.database.from("cells").insert([
      {
        candidate_id: row.candidate_id,
        parameter_key: row.parameter_key,
        tier: row.tier,
        value: row.value,
        citation: best
          ? {
              url: best.url,
              title: best.title,
              snippet: best.excerpt,
              retrieved_at: best.retrieved_at,
            }
          : null,
        confidence: row.final_confidence,
        reason: row.reason,
        llm_call_id: null,
      },
    ]);
    if (insertError) throw new Error(`Promotion failed: ${insertError.message}`);
  }
  return rows.length;
}

async function resultIdFor(
  insforge: InsForgeClient,
  runId: string,
  row: { candidate_id: string; parameter_key: string },
): Promise<string> {
  const { data, error } = await insforge.database
    .from("cell_research_results")
    .select("id")
    .eq("run_id", runId)
    .eq("candidate_id", row.candidate_id)
    .eq("parameter_key", row.parameter_key)
    .single();
  if (error || !data) throw new Error("Promotion result row disappeared");
  return (data as { id: string }).id;
}

function parseTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function providerConfigurationSnapshot(): Record<string, unknown> {
  const enabled = (name: string) => Boolean(process.env[name]?.trim());
  return {
    exa: enabled("EXA_API_KEY"),
    brave: enabled("BRAVE_SEARCH_API_KEY"),
    bright_data: enabled("BRIGHT_DATA_API_KEY") && enabled("BRIGHT_DATA_ZONE"),
    sec_edgar: enabled("SEC_USER_AGENT"),
    gleif: true,
    companies_house: enabled("COMPANIES_HOUSE_API_KEY"),
    perplexity:
      enabled("PERPLEXITY_API_KEY") &&
      process.env.CELL_RESEARCH_PERPLEXITY_ENABLED === "true",
    extract_model:
      process.env.CELL_RESEARCH_EXTRACT_MODEL ??
      process.env.STAGE_1_MODEL ??
      "anthropic/claude-sonnet-4.6",
    extract_fallback_model:
      process.env.CELL_RESEARCH_EXTRACT_FALLBACK_MODEL ??
      process.env.STAGE_1_CRITIC_MODEL ??
      "openai/gpt-5.5",
    verify_model:
      process.env.CELL_RESEARCH_VERIFY_MODEL ??
      process.env.STAGE_1_CRITIC_MODEL ??
      "openai/gpt-5.5",
  };
}

async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= maxAttempts ||
        !/(network request failed|fetch failed|timed? out|timeout|terminated)/iu.test(
          message,
        )
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}
