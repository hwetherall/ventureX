import type { InsForgeClient } from "@/lib/insforge/server";
import type { Parameter } from "@/types/parameter";

import { ResearchBudgetTracker } from "./budget";
import { ResearchBudgetError, ResearchProviderError } from "./errors";
import { extractCellFromEvidence } from "./extraction";
import { renderPolicyQueries, rollingDate } from "./policies";
import {
  isTransientOpenRouterError,
  withTransientOpenRouterRetry,
} from "./retry";
import {
  fetchedHitToEvidence,
  mergeAndRankSearchHits,
  officialFactToEvidence,
  type RankedSearchHit,
} from "./source-ranker";
import type {
  CandidateIdentity,
  ContentProvider,
  OfficialDataProvider,
  ProviderCallRecord,
  ResearchCellOutcome,
  ResearchEvidence,
  ResearchPolicy,
  SearchProvider,
} from "./types";
import {
  canonicalizeResearchUrl,
  domainForUrl,
  inferSourceClass,
  providerCostEstimate,
  researchContentHash,
  sanitizeResearchText,
} from "./utils";
import { computeFinalConfidence, verifyCellEvidence } from "./verification";

export interface ResearchProviderSet {
  search: SearchProvider[];
  primaryContent: ContentProvider;
  fallbackContent?: ContentProvider;
  official: OfficialDataProvider[];
}

export async function researchOneCell(args: {
  insforge: InsForgeClient;
  runId: string;
  ventureId: string;
  candidate: CandidateIdentity;
  parameter: Parameter;
  policy: ResearchPolicy;
  providers: ResearchProviderSet;
  budget: ResearchBudgetTracker;
  asOf: string;
  productHint?: string;
}): Promise<ResearchCellOutcome> {
  const started = Date.now();
  const retrievedAt = new Date().toISOString();
  const attempts: ProviderCallRecord[] = [];
  let evidence: ResearchEvidence[] = [];
  let cellCost = 0;
  let final: ReturnType<typeof computeFinalConfidence> | null = null;
  let proposedConfidence: ResearchCellOutcome["proposedConfidence"] = "unknown";
  let verification: ResearchCellOutcome["verification"] = null;

  const official = await acquireOfficialEvidence({
    candidate: args.candidate,
    parameter: args.parameter,
    policy: args.policy,
    providers: args.providers.official,
    asOf: args.asOf,
    retrievedAt,
    attempts,
  });
  evidence.push(...official.evidence);
  cellCost += official.costUsd;

  const initialQueries = renderPolicyQueries({
    policy: args.policy,
    candidate: args.candidate,
    asOf: args.asOf,
    productHint: args.productHint,
  });
  const initial = await acquireWebEvidence({
    candidate: args.candidate,
    policy: args.policy,
    searchProviders: args.providers.search,
    primaryContent: args.providers.primaryContent,
    fallbackContent: args.providers.fallbackContent,
    queries: initialQueries,
    asOf: args.asOf,
    retrievedAt,
    attempts,
    budget: args.budget,
    existingUrls: new Set(evidence.map((item) => item.canonicalUrl)),
    maximumSearches: args.policy.maximumSearches,
    maximumFetchedPages: args.policy.maximumFetchedPages,
  });
  evidence.push(...initial.evidence);
  cellCost += initial.costUsd;

  for (let pass = 0; pass < args.policy.maximumAttempts; pass++) {
    if (evidence.length === 0) break;
    const extractReservation = args.budget.reserve(0.35);
    let extracted;
    try {
      extracted = await extractWithModelFailover({
        insforge: args.insforge,
        ventureId: args.ventureId,
        candidate: args.candidate,
        parameter: args.parameter,
        policy: args.policy,
        evidence,
        asOf: args.asOf,
      });
      args.budget.settle(0.35, extracted.costUsd, extractReservation);
    } catch (error) {
      extractReservation();
      throw error;
    }
    cellCost += extracted.costUsd;
    proposedConfidence = extracted.proposed.proposed_confidence;
    attempts.push({
      provider: "openrouter",
      operation: "extract",
      requestMetadata: {
        model: extracted.model,
        fallback_model_used:
          extracted.model !==
          (process.env.CELL_RESEARCH_EXTRACT_MODEL ??
            process.env.STAGE_1_MODEL ??
            "anthropic/claude-sonnet-4.6"),
        evidence_count: evidence.length,
        pass: pass + 1,
      },
      responseMetadata: {
        proposed_confidence: proposedConfidence,
        llm_call_id: extracted.llmCallId,
      },
      resultCount: 1,
      costUsd: extracted.costUsd,
      latencyMs: extracted.latencyMs,
    });
    if (extracted.proposed.parameter_key !== args.parameter.id) {
      throw new Error(
        `Extractor returned parameter '${extracted.proposed.parameter_key}' for '${args.parameter.id}'.`,
      );
    }

    const verifyReservation = args.budget.reserve(0.35);
    let verified;
    try {
      verified = await withTransientOpenRouterRetry(() =>
        verifyCellEvidence({
          insforge: args.insforge,
          ventureId: args.ventureId,
          candidate: args.candidate,
          parameter: args.parameter,
          policy: args.policy,
          proposed: extracted.proposed,
          evidence,
          asOf: args.asOf,
        }),
      );
      args.budget.settle(0.35, verified.costUsd, verifyReservation);
    } catch (error) {
      verifyReservation();
      throw error;
    }
    cellCost += verified.costUsd;
    verification = verified.verification;
    attempts.push({
      provider: "openrouter",
      operation: "verify",
      requestMetadata: {
        model:
          process.env.CELL_RESEARCH_VERIFY_MODEL ??
          process.env.STAGE_1_CRITIC_MODEL ??
          "openai/gpt-5.5",
        evidence_count: evidence.length,
        pass: pass + 1,
      },
      responseMetadata: {
        supports_exact_value: verification.supports_exact_value,
        llm_call_id: verified.llmCallId,
      },
      resultCount: 1,
      costUsd: verified.costUsd,
      latencyMs: verified.latencyMs,
    });
    final = computeFinalConfidence({
      proposed: extracted.proposed,
      verification,
      policy: args.policy,
      evidence,
      asOf: args.asOf,
    });
    if (final.confidence !== "unknown") break;
    if (pass + 1 >= args.policy.maximumAttempts) break;

    const repairQuery = buildRepairQuery({
      candidate: args.candidate,
      parameter: args.parameter,
      policy: args.policy,
      reason: final.reason,
    });
    const repair = await acquireWebEvidence({
      candidate: args.candidate,
      policy: args.policy,
      searchProviders: args.providers.search,
      primaryContent: args.providers.primaryContent,
      fallbackContent: args.providers.fallbackContent,
      queries: [repairQuery],
      asOf: args.asOf,
      retrievedAt,
      attempts,
      budget: args.budget,
      existingUrls: new Set(evidence.map((item) => item.canonicalUrl)),
      maximumSearches: Math.min(2, args.policy.maximumSearches),
      maximumFetchedPages: Math.min(2, args.policy.maximumFetchedPages),
    });
    if (repair.evidence.length === 0) break;
    evidence = [...evidence, ...repair.evidence];
    cellCost += repair.costUsd;
  }

  if (!final) {
    final = {
      confidence: "unknown",
      value: null,
      reason:
        evidence.length === 0
          ? "no_acceptable_evidence_found"
          : "extraction_or_verification_did_not_produce_an_accepted_value",
      evidence: evidence.map((item) => ({
        ...item,
        disposition: "rejected" as const,
        supportedValuePaths: [],
      })),
    };
  }

  return {
    candidateId: args.candidate.candidateId,
    parameterKey: args.parameter.id,
    tier: args.parameter.tier,
    value: final.value,
    proposedConfidence,
    finalConfidence: final.confidence,
    reason: final.reason,
    verification,
    evidence: final.evidence,
    attempts,
    costUsd: cellCost,
    latencyMs: Date.now() - started,
  };
}

async function extractWithModelFailover(
  args: Parameters<typeof extractCellFromEvidence>[0],
): ReturnType<typeof extractCellFromEvidence> {
  const primaryModel =
    process.env.CELL_RESEARCH_EXTRACT_MODEL ??
    process.env.STAGE_1_MODEL ??
    "anthropic/claude-sonnet-4.6";
  try {
    return await withTransientOpenRouterRetry(() =>
      extractCellFromEvidence({ ...args, model: primaryModel }),
    );
  } catch (error) {
    if (!isTransientOpenRouterError(error)) throw error;
    const fallbackModel =
      process.env.CELL_RESEARCH_EXTRACT_FALLBACK_MODEL ??
      process.env.STAGE_1_CRITIC_MODEL ??
      "openai/gpt-5.5";
    if (fallbackModel === primaryModel) throw error;
    return withTransientOpenRouterRetry(
      () => extractCellFromEvidence({ ...args, model: fallbackModel }),
      { maxAttempts: 2 },
    );
  }
}

async function acquireOfficialEvidence(args: {
  candidate: CandidateIdentity;
  parameter: Parameter;
  policy: ResearchPolicy;
  providers: OfficialDataProvider[];
  asOf: string;
  retrievedAt: string;
  attempts: ProviderCallRecord[];
}): Promise<{ evidence: ResearchEvidence[]; costUsd: number }> {
  const evidence: ResearchEvidence[] = [];
  let costUsd = 0;
  const ordered = args.policy.officialProviders.flatMap((name) =>
    args.providers.filter((provider) => provider.name === name),
  );
  for (const provider of ordered) {
    if (!provider.supports(args.parameter.id, args.candidate)) continue;
    const started = Date.now();
    try {
      const facts = await provider.lookup({
        candidate: args.candidate,
        parameterKey: args.parameter.id,
        asOf: args.asOf,
      });
      const factCost = facts.reduce((sum, fact) => sum + fact.costUsd, 0);
      costUsd += factCost;
      args.attempts.push({
        provider: provider.name,
        operation: "official_lookup",
        requestMetadata: { parameter_key: args.parameter.id },
        responseMetadata: {},
        resultCount: facts.length,
        costUsd: factCost,
        latencyMs: Date.now() - started,
      });
      evidence.push(
        ...facts.map((fact) =>
          officialFactToEvidence({
            fact,
            candidate: args.candidate,
            retrievedAt: args.retrievedAt,
          }),
        ),
      );
    } catch (error) {
      args.attempts.push({
        provider: provider.name,
        operation: "official_lookup",
        requestMetadata: { parameter_key: args.parameter.id },
        responseMetadata: {},
        resultCount: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        error: safeError(error),
      });
    }
  }
  return { evidence, costUsd };
}

async function acquireWebEvidence(args: {
  candidate: CandidateIdentity;
  policy: ResearchPolicy;
  searchProviders: SearchProvider[];
  primaryContent: ContentProvider;
  fallbackContent?: ContentProvider;
  queries: string[];
  asOf: string;
  retrievedAt: string;
  attempts: ProviderCallRecord[];
  budget: ResearchBudgetTracker;
  existingUrls: Set<string>;
  maximumSearches: number;
  maximumFetchedPages: number;
}): Promise<{ evidence: ResearchEvidence[]; costUsd: number }> {
  let costUsd = 0;
  const searchJobs = args.queries.flatMap((query) =>
    args.searchProviders.map((provider) => ({ query, provider })),
  ).slice(0, args.maximumSearches);
  const settled = await Promise.all(
    searchJobs.map(async ({ query, provider }) => {
      const estimate = providerCostEstimate(provider.name);
      const release = args.budget.reserve(estimate);
      const started = Date.now();
      try {
        const response = await provider.search({
          query,
          count: 10,
          ...(args.policy.freshness?.dateWindow === "rolling_12_months"
            ? {
                dateFrom: rollingDate(args.asOf, 365),
                dateTo: args.asOf.slice(0, 10),
              }
            : {}),
          timeoutMs: 20_000,
        });
        args.budget.settle(estimate, response.costUsd, release);
        args.attempts.push({
          provider: provider.name,
          operation: "search",
          query,
          requestMetadata: {
            count: 10,
            date_window: args.policy.freshness?.dateWindow ?? null,
          },
          responseMetadata: {
            provider_request_id: response.providerRequestId ?? null,
          },
          resultCount: response.hits.length,
          costUsd: response.costUsd,
          latencyMs: response.latencyMs,
        });
        return response;
      } catch (error) {
        release();
        args.attempts.push({
          provider: provider.name,
          operation: "search",
          query,
          requestMetadata: { count: 10 },
          responseMetadata: {},
          resultCount: 0,
          costUsd: 0,
          latencyMs: Date.now() - started,
          error: safeError(error),
        });
        return null;
      }
    }),
  );
  const responses = settled.filter((value) => value !== null);
  for (const response of responses) costUsd += response.costUsd;
  const hits = mergeAndRankSearchHits({
    hits: responses.flatMap((response) => response.hits),
    candidate: args.candidate,
    policy: args.policy,
    asOf: args.asOf,
  }).filter((hit) => !args.existingUrls.has(hit.canonicalUrl));

  const evidence: ResearchEvidence[] = [];
  for (const hit of hits.slice(0, args.maximumFetchedPages)) {
    const fetched = await fetchWithFallback({
      hit,
      primary: args.primaryContent,
      fallback: args.fallbackContent,
      attempts: args.attempts,
      budget: args.budget,
      retrievedAt: args.retrievedAt,
    });
    costUsd += fetched.costUsd;
    if (fetched.evidence) evidence.push(fetched.evidence);
  }
  return { evidence, costUsd };
}

async function fetchWithFallback(args: {
  hit: RankedSearchHit;
  primary: ContentProvider;
  fallback?: ContentProvider;
  attempts: ProviderCallRecord[];
  budget: ResearchBudgetTracker;
  retrievedAt: string;
}): Promise<{ evidence: ResearchEvidence | null; costUsd: number }> {
  const providers = [args.primary, ...(args.fallback ? [args.fallback] : [])];
  let costUsd = 0;
  for (const provider of providers) {
    const estimate = providerCostEstimate(provider.name);
    const release = args.budget.reserve(estimate);
    const started = Date.now();
    try {
      const response = await provider.fetch({
        url: args.hit.canonicalUrl,
        maxCharacters: 40_000,
        timeoutMs: provider.name === "bright_data" ? 45_000 : 30_000,
      });
      args.budget.settle(estimate, response.costUsd, release);
      costUsd += response.costUsd;
      args.attempts.push({
        provider: provider.name,
        operation: "fetch",
        requestMetadata: { url: args.hit.canonicalUrl },
        responseMetadata: {
          content_characters: response.content.length,
          provider_request_id: response.providerRequestId ?? null,
        },
        resultCount: 1,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
      });
      return {
        evidence: fetchedHitToEvidence({
          hit: args.hit,
          content: response.content,
          title: response.title,
          provider: provider.name as "exa" | "bright_data",
          providerRequestId: response.providerRequestId,
          publishedAt: response.publishedAt,
          retrievedAt: args.retrievedAt,
        }),
        costUsd,
      };
    } catch (error) {
      release();
      args.attempts.push({
        provider: provider.name,
        operation: "fetch",
        requestMetadata: { url: args.hit.canonicalUrl },
        responseMetadata: {},
        resultCount: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        error: safeError(error),
      });
    }
  }

  // Last-resort evidence is the search excerpt itself. It remains subject to
  // the independent verifier and can never become verified merely because a
  // search engine returned it.
  if (args.hit.snippet.trim()) {
    const canonicalUrl = canonicalizeResearchUrl(args.hit.url);
    return {
      evidence: {
        provider: args.hit.provider,
        providerRequestId: args.hit.providerRequestId ?? null,
        url: args.hit.url,
        canonicalUrl,
        title: sanitizeResearchText(args.hit.title, 500),
        sourceDomain: domainForUrl(canonicalUrl),
        sourceClass: inferSourceClass(canonicalUrl, []),
        excerpt: sanitizeResearchText(args.hit.snippet, 6_000),
        fullContent: args.hit.snippet,
        publishedAt: args.hit.publishedAt ?? null,
        effectiveAt: null,
        retrievedAt: args.retrievedAt,
        searchQuery: args.hit.searchQuery ?? null,
        resultRank: args.hit.rank,
        contentHash: researchContentHash(args.hit.snippet),
        candidateMatch: args.hit.candidateMatch,
        disposition: "rejected",
        supportedValuePaths: [],
        verifierReason: null,
      },
      costUsd,
    };
  }
  return { evidence: null, costUsd };
}

function buildRepairQuery(args: {
  candidate: CandidateIdentity;
  parameter: Parameter;
  policy: ResearchPolicy;
  reason: string;
}): string {
  return [
    `"${args.candidate.name}"`,
    args.parameter.name,
    args.policy.proofRule,
    `Evidence gap: ${args.reason}`,
  ].join(" ").slice(0, 1_500);
}

function safeError(error: unknown): string {
  if (error instanceof ResearchBudgetError) return error.message;
  if (error instanceof ResearchProviderError) return error.message.slice(0, 500);
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
