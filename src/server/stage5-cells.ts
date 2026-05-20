import type { InsForgeClient } from "@/lib/insforge/server";
import {
  exaSearch,
  exaSearchWithBroadenRetry,
  type ExaSearchResponse,
  type ExaSearchResult,
} from "@/lib/exa/search";
import { ExaError } from "@/lib/exa/errors";
import { buildTier3Query } from "@/lib/exa/query";
import { callLLM } from "@/lib/openrouter/call";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "@/lib/openrouter/errors";
import { predictStage5Cost } from "@/lib/openrouter/predict";
import { loadPrompt } from "@/lib/prompts";
import { errorMessage } from "@/lib/utils";
import {
  CellRowSchema,
  makeStrictTier1BatchSchema,
  makeStrictTier2BatchSchema,
  Tier3CellOutputSchema,
  type CellCitation,
  type CellRow,
  type Tier1BatchOutput,
  type Tier2BatchOutput,
  type Tier3CellOutput,
} from "@/types/cell";
import {
  ParameterSchema,
  type Parameter,
  type ParameterTier,
} from "@/types/parameter";

const STAGE_T1 = "stage_5_t1";
const STAGE_T2 = "stage_5_t2";
const STAGE_T3 = "stage_5_t3";

const PRECONDITION_STATUS = "parameters_ready" as const;
const IN_PROGRESS_STATUS = "cells_researching" as const;
const SUCCESS_STATUS = "cells_ready" as const;

const DEFAULT_T1_MODEL = "anthropic/claude-opus-4.7";
const DEFAULT_T2_MODEL = "anthropic/claude-opus-4.7";
// Sonnet 4.6 chosen over Haiku 4.5 (2026-05-19 user decision) — Haiku
// struggles with extraction from messy Exa snippets; Sonnet is the right
// cost/quality trade for the venture-specific differentiator cells.
const DEFAULT_T3_MODEL = "anthropic/claude-sonnet-4.6";

const T1_TIMEOUT_MS = 180_000;
const T2_TIMEOUT_MS = 240_000;
const T3_TIMEOUT_MS = 60_000;

// Per-cell Exa+Sonnet pair concurrency within a single candidate
// (M15_DESIGN.md §Concurrency line 135). Conservative 3 — Exa's documented
// limit is higher but we want headroom.
const T3_CONCURRENCY = 3;

// Per-venture budget cap layered on top of D4's per-run $5 cap.
// P3-D27 / M15_SPRINT_PLAN.md Clarification #6.
const DEFAULT_PER_VENTURE_BUDGET_CAP_USD = 100;

const PROMPT_T1 = "stage_5_tier1_universal.md";
const PROMPT_T2 = "stage_5_tier2_framework.md";
const PROMPT_T3 = "stage_5_tier3_dynamic.md";

const PROMPT_INPUT_PLACEHOLDER = /\[The .*? will be appended below\.?\]\s*$/;

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface RunStage5CellResearchInput {
  ventureId: string;
  candidateId: string;
  insforge: InsForgeClient;
}

export type RunStage5CellResearchResult =
  | {
      ok: true;
      candidateId: string;
      cellsWritten: number;
      unknownCount: number;
      costUsd: number;
      latencyMs: number;
      tierBreakdown: { tier: ParameterTier; cells: number; costUsd: number }[];
    }
  | { ok: false; error: string };

export interface RunStage5MultiInput {
  ventureId: string;
  candidateIds: string[];
  insforge: InsForgeClient;
  /** Within-venture concurrency. Default 3 — matches T3's per-cell cap and Exa's documented 10 RPS limit headroom. */
  concurrency?: number;
}

export type RunStage5MultiResult =
  | {
      ok: true;
      successCount: number;
      failureCount: number;
      cellsWritten: number;
      unknownCount: number;
      costUsd: number;
      latencyMs: number;
      perCandidate: {
        candidateId: string;
        ok: boolean;
        cellsWritten?: number;
        unknownCount?: number;
        costUsd?: number;
        error?: string;
      }[];
    }
  | { ok: false; error: string };

// ────────────────────────────────────────────────────────────────────────
// Internal row shapes
// ────────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  name: string;
  rationale: string;
  citations: unknown; // jsonb — validated below
}

interface ParameterRunRow {
  id: string;
  full_parameter_schema: unknown; // jsonb array
}

interface VentureRow {
  id: string;
  status: string;
  current_run_id: string | null;
  user_provided_description: string;
}

interface M13CitationInput {
  id: string;
  url: string;
  title: string;
  query: string;
  /**
   * M15-F2 (T2 pre-search): identifies whether this citation came from the
   * M13 candidate-brainstorm output or from the M15 Tier 2 corporate-search
   * pre-pass. Both are eligible as Tier 2 citation sources; the field is
   * surfaced into prompt assembly so the model can see provenance.
   */
  source: "m13" | "t2_presearch";
  /**
   * Pre-search results carry a snippet (Exa returns it); M13 citations do
   * not (M13 stored only url/title/query). Optional so both shapes are
   * representable.
   */
  snippet?: string;
}

/**
 * M15-F2 (T2 pre-search): five canonical corporate-evidence queries that
 * surface the URL profile T2 framework facts actually need (annual reports,
 * IR pages, partner press releases, named customers, manufacturing
 * footprint). Each query gets the candidate name prepended and `includeText`
 * filtering server-side.
 *
 * Why 5 and not 10: latency budget. At 5 parallel Exa calls (~3-5s each),
 * pre-search adds ~5s to the wedge wall-clock. 10 would double that without
 * meaningful coverage gain — these 5 topics are the high-leverage business
 * facets T2 needs.
 */
const T2_PRESEARCH_QUERIES: string[] = [
  "annual report financial results revenue",
  "investor relations IR briefing",
  "partners distribution channel resellers",
  "customers contracts case study deployment",
  "manufacturing operations facility supply chain",
];

const T2_PRESEARCH_RESULTS_PER_QUERY = 2;

// ────────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────────

/**
 * Single-candidate entry point. Thin wrapper around the multi-candidate
 * orchestrator for callers that haven't been migrated yet (the dossier
 * page's "Research dossier" button still uses this shape).
 */
export async function runStage5CellResearch(
  input: RunStage5CellResearchInput,
): Promise<RunStage5CellResearchResult> {
  const startTime = Date.now();
  const multi = await runStage5CellResearchMulti({
    ventureId: input.ventureId,
    candidateIds: [input.candidateId],
    insforge: input.insforge,
    concurrency: 1,
  });

  if (!multi.ok) {
    return { ok: false, error: multi.error };
  }

  const candidateResult = multi.perCandidate[0];
  if (!candidateResult || !candidateResult.ok) {
    return {
      ok: false,
      error: candidateResult?.error ?? "candidate failed without specific error",
    };
  }

  return {
    ok: true,
    candidateId: input.candidateId,
    cellsWritten: candidateResult.cellsWritten ?? 0,
    unknownCount: candidateResult.unknownCount ?? 0,
    costUsd: candidateResult.costUsd ?? 0,
    latencyMs: Date.now() - startTime,
    // tierBreakdown is informational; the multi orchestrator rolls these
    // up across candidates so the per-candidate breakdown isn't recovered
    // here. Callers that need it should migrate to runStage5CellResearchMulti.
    tierBreakdown: [],
  };
}

/**
 * Multi-candidate orchestrator (M16-A2). Claims venture status once, runs
 * N candidates with bounded concurrency, transitions to cells_ready when
 * every candidate has been attempted. Per-candidate failures are recorded
 * in the result but do NOT fail the whole batch — partial progress is
 * preserved and the user can re-research failed candidates individually.
 */
export async function runStage5CellResearchMulti(
  input: RunStage5MultiInput,
): Promise<RunStage5MultiResult> {
  const { ventureId, candidateIds, insforge } = input;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 5));
  const startTime = Date.now();

  if (candidateIds.length === 0) {
    return { ok: false, error: "No candidate ids supplied." };
  }

  try {
    const venture = await claimCellsResearchingStatus(insforge, ventureId);
    const { parameters } = await loadLatestParameterSchema(insforge, ventureId);

    // Pre-flight predictor over the FULL batch. Single point at which we
    // gate the per-venture budget cap.
    const prediction = predictStage5Cost({
      parameters,
      candidateCount: candidateIds.length,
    });
    if (prediction.exceedsBudgetCap) {
      throw new OrchestratorError(
        `Cell research for ${candidateIds.length} candidates would exceed per-venture cap of $${DEFAULT_PER_VENTURE_BUDGET_CAP_USD}. ` +
          `Estimated upper bound: $${prediction.costUsd.max.toFixed(2)}.`,
      );
    }

    const limiter = createConcurrencyLimiter(concurrency);
    const perCandidate = await Promise.all(
      candidateIds.map((candidateId) =>
        limiter(() =>
          researchSingleCandidate({
            insforge,
            ventureId,
            candidateId,
            parameters,
            currentRunId: venture.current_run_id,
            ventureDescription: venture.user_provided_description,
          }),
        ),
      ),
    );

    await markCellsReady(insforge, ventureId);

    const successCount = perCandidate.filter((r) => r.ok).length;
    const failureCount = perCandidate.length - successCount;
    const cellsWritten = perCandidate.reduce(
      (acc, r) => acc + (r.cellsWritten ?? 0),
      0,
    );
    const unknownCount = perCandidate.reduce(
      (acc, r) => acc + (r.unknownCount ?? 0),
      0,
    );
    const costUsd = perCandidate.reduce(
      (acc, r) => acc + (r.costUsd ?? 0),
      0,
    );

    return {
      ok: true,
      successCount,
      failureCount,
      cellsWritten,
      unknownCount,
      costUsd,
      latencyMs: Date.now() - startTime,
      perCandidate,
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

interface PerCandidateResult {
  candidateId: string;
  ok: boolean;
  cellsWritten?: number;
  unknownCount?: number;
  costUsd?: number;
  error?: string;
}

interface ResearchSingleCandidateInput {
  insforge: InsForgeClient;
  ventureId: string;
  candidateId: string;
  parameters: Parameter[];
  currentRunId: string | null;
  ventureDescription: string;
}

/**
 * Inner per-candidate work. Does NOT touch venture status — the outer
 * orchestrator owns that. Catches per-candidate failures and returns
 * them in a result envelope so a single bad candidate doesn't fail the
 * whole batch.
 */
async function researchSingleCandidate(
  input: ResearchSingleCandidateInput,
): Promise<PerCandidateResult> {
  const {
    insforge,
    ventureId,
    candidateId,
    parameters,
    currentRunId,
    ventureDescription,
  } = input;

  try {
    const candidate = await loadCandidate(insforge, candidateId, ventureId);
    const partitioned = partitionByTier(parameters);
    const m13Citations = parseM13Citations(candidate.citations);

    const t1Model = process.env.STAGE_5_TIER_1_MODEL ?? DEFAULT_T1_MODEL;
    const t2Model = process.env.STAGE_5_TIER_2_MODEL ?? DEFAULT_T2_MODEL;
    const t3Model = process.env.STAGE_5_TIER_3_MODEL ?? DEFAULT_T3_MODEL;
    const runTimestamp = new Date().toISOString();

    // Tier 1 — batched Opus, training-data only.
    const t1Result = await runTier1Batch({
      insforge,
      ventureId,
      candidate,
      parameters: partitioned.universal,
      model: t1Model,
      runId: currentRunId,
      ventureDescription,
    });
    await insertCells(insforge, t1Result.cells);

    // Tier 2 — pre-search + batched Opus with merged evidence.
    const presearchCitations =
      partitioned.framework.length > 0
        ? await runTier2PreSearch({
            insforge,
            ventureId,
            candidateId,
            candidateName: candidate.name,
          })
        : [];
    const t2EvidencePool = mergeCitationSets(m13Citations, presearchCitations);

    const t2Result = await runTier2Batch({
      insforge,
      ventureId,
      candidate,
      parameters: partitioned.framework,
      m13Citations: t2EvidencePool,
      runTimestamp,
      model: t2Model,
      runId: currentRunId,
      ventureDescription,
    });
    await insertCells(insforge, t2Result.cells);

    // Tier 3 — per-cell Exa + Sonnet, 3-concurrent within candidate.
    const t3Result = await runTier3Loop({
      insforge,
      ventureId,
      candidate,
      parameters: partitioned.dynamic,
      runTimestamp,
      model: t3Model,
      runId: currentRunId,
    });
    await insertCells(insforge, t3Result.cells);

    const cellsWritten =
      t1Result.cells.length + t2Result.cells.length + t3Result.cells.length;
    const unknownCount =
      countUnknown(t1Result.cells) +
      countUnknown(t2Result.cells) +
      countUnknown(t3Result.cells);
    const costUsd = t1Result.costUsd + t2Result.costUsd + t3Result.costUsd;

    return {
      candidateId,
      ok: true,
      cellsWritten,
      unknownCount,
      costUsd,
    };
  } catch (err) {
    return {
      candidateId,
      ok: false,
      error: formatErrorForUser(err),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Status claim + input loading
// ────────────────────────────────────────────────────────────────────────

class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

class PreconditionError extends Error {
  constructor(public readonly actualStatus: string) {
    super(
      `Cell research requires status='${PRECONDITION_STATUS}' on entry; venture is in status='${actualStatus}'. Generate parameters before researching cells.`,
    );
    this.name = "PreconditionError";
  }
}

/**
 * Atomic precondition check + status transition. Same pattern as
 * stage4-parameters.claimCandidatesReadyStatus (which mirrors P3-D5):
 * conditional UPDATE returns zero rows when status doesn't match, so two
 * concurrent runs can't both proceed past this point.
 */
async function claimCellsResearchingStatus(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<VentureRow> {
  const { data, error } = await insforge.database
    .from("ventures")
    .update({ status: IN_PROGRESS_STATUS, error_message: null })
    .eq("id", ventureId)
    .eq("status", PRECONDITION_STATUS)
    .select("id, status, current_run_id, user_provided_description");

  if (error) {
    throw new OrchestratorError(
      `Failed to claim cell-research slot: ${error.message}`,
    );
  }

  const rows = (data as unknown as VentureRow[]) ?? [];
  if (rows.length === 0) {
    const { data: existing } = await insforge.database
      .from("ventures")
      .select("status")
      .eq("id", ventureId)
      .maybeSingle();

    if (!existing) {
      throw new OrchestratorError(`Venture not found (id=${ventureId}).`);
    }
    throw new PreconditionError((existing as { status: string }).status);
  }

  return rows[0]!;
}

async function loadCandidate(
  insforge: InsForgeClient,
  candidateId: string,
  ventureId: string,
): Promise<CandidateRow> {
  const { data, error } = await insforge.database
    .from("candidate_companies")
    .select("id, name, rationale, citations, venture_id")
    .eq("id", candidateId)
    .eq("venture_id", ventureId)
    .maybeSingle();

  if (error) {
    throw new OrchestratorError(
      `Failed to load candidate ${candidateId}: ${error.message}`,
    );
  }
  if (!data) {
    throw new OrchestratorError(
      `Candidate ${candidateId} not found under venture ${ventureId}.`,
    );
  }

  return data as unknown as CandidateRow;
}

async function loadLatestParameterSchema(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{ parameterRunId: string; parameters: Parameter[] }> {
  const { data, error } = await insforge.database
    .from("parameter_generation_runs")
    .select("id, full_parameter_schema, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new OrchestratorError(
      `Failed to load parameter_generation_runs: ${error.message}`,
    );
  }
  if (!data) {
    throw new OrchestratorError(
      "No parameter generation runs found. Build parameters before researching cells.",
    );
  }

  const row = data as unknown as ParameterRunRow;
  const rawSchema = row.full_parameter_schema;
  if (!Array.isArray(rawSchema)) {
    throw new OrchestratorError(
      `Stored full_parameter_schema is not an array (parameter_run_id=${row.id}).`,
    );
  }
  const parsed: Parameter[] = [];
  for (const entry of rawSchema) {
    const ok = ParameterSchema.safeParse(entry);
    if (!ok.success) {
      throw new OrchestratorError(
        `Stored parameter does not validate (parameter_run_id=${row.id}): ${ok.error.message}`,
      );
    }
    parsed.push(ok.data);
  }
  return { parameterRunId: row.id, parameters: parsed };
}

/** @internal Exported for tests. */
export function partitionByTier(parameters: Parameter[]): {
  universal: Parameter[];
  framework: Parameter[];
  dynamic: Parameter[];
} {
  const out = { universal: [] as Parameter[], framework: [] as Parameter[], dynamic: [] as Parameter[] };
  for (const p of parameters) {
    out[p.tier].push(p);
  }
  return out;
}

/**
 * Parse the candidate's stored M13 citations (jsonb on candidate_companies)
 * into a tagged list with `[c1]`, `[c2]`, ... ids so the Tier 2 prompt can
 * reference them.
 */
function parseM13Citations(raw: unknown): M13CitationInput[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, idx) => {
    const obj = entry as { url?: string; title?: string; query?: string };
    return {
      id: `c${idx + 1}`,
      url: obj.url ?? "",
      title: obj.title ?? "",
      query: obj.query ?? "",
      source: "m13" as const,
    };
  });
}

/**
 * M15-F2: run the 5 parallel corporate-evidence Exa queries and convert
 * results into M13CitationInput shape so prompt assembly is uniform.
 *
 * Uses `Promise.allSettled` (per /plan-eng-review critical-gap flag) so a
 * single query failure does not fail the tier — partial coverage is better
 * than zero coverage. Failures are logged to exa_call_logs.
 */
/** @internal Exported for tests. */
export async function runTier2PreSearch(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidateId: string;
  candidateName: string;
}): Promise<M13CitationInput[]> {
  const queries = T2_PRESEARCH_QUERIES.map((q) => `${args.candidateName} ${q}`);

  const settled = await Promise.allSettled(
    queries.map((query) =>
      exaSearch({
        query,
        numResults: T2_PRESEARCH_RESULTS_PER_QUERY,
        // F1: server-side anchoring on candidate name. Without this, the
        // pre-search just inherits the same "topical-match, candidate-wrong"
        // failure mode that motivated F1 for Tier 3.
        includeText: args.candidateName,
      }),
    ),
  );

  const citations: M13CitationInput[] = [];
  let serial = 1;
  const seenUrls = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const query = queries[i]!;

    if (result.status === "rejected") {
      // Log the failure but don't abort the tier; the orchestrator continues
      // with whatever pre-search results landed.
      await logExaCall(args.insforge, {
        ventureId: args.ventureId,
        candidateId: args.candidateId,
        parameterKey: null,
        stage: "stage_5_t2_presearch",
        query,
        response: { results: [], latencyMs: 0 },
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
      continue;
    }

    const response = result.value;
    await logExaCall(args.insforge, {
      ventureId: args.ventureId,
      candidateId: args.candidateId,
      parameterKey: null,
      stage: "stage_5_t2_presearch",
      query,
      response,
    });

    for (const hit of response.results) {
      if (seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);
      citations.push({
        id: `p${serial++}`,
        url: hit.url,
        title: hit.title,
        query,
        source: "t2_presearch",
        snippet: hit.text,
      });
    }
  }

  return citations;
}

/**
 * Dedupe pre-search citations against the M13 set by URL. M13 citations
 * win on tie (preserves the existing `c1`/`c2`/... id stability for the
 * prompt) and we just drop the duplicate pre-search row.
 */
/** @internal Exported for tests. */
export function mergeCitationSets(
  m13: M13CitationInput[],
  presearch: M13CitationInput[],
): M13CitationInput[] {
  const m13Urls = new Set(m13.map((c) => c.url));
  const out = [...m13];
  for (const p of presearch) {
    if (m13Urls.has(p.url)) continue;
    out.push(p);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Tier 1 — batched Opus, training-data only
// ────────────────────────────────────────────────────────────────────────

interface TierRunResult {
  cells: CellRow[];
  costUsd: number;
  latencyMs: number;
  llmCallId: string;
}

async function runTier1Batch(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateRow;
  parameters: Parameter[];
  model: string;
  runId: string | null;
  ventureDescription: string;
}): Promise<TierRunResult> {
  if (args.parameters.length === 0) {
    return { cells: [], costUsd: 0, latencyMs: 0, llmCallId: "" };
  }

  const promptBody = await loadPrompt(PROMPT_T1);
  const prompt = assembleTier1Prompt(promptBody, {
    candidateName: args.candidate.name,
    candidateRationale: args.candidate.rationale,
    ventureDescription: args.ventureDescription,
    parameters: args.parameters,
  });

  const expectedKeys = args.parameters.map((p) => p.id);
  const schema = makeStrictTier1BatchSchema(expectedKeys);

  const result = await callLLM<Tier1BatchOutput>({
    insforge: args.insforge,
    model: args.model,
    stage: STAGE_T1,
    prompt,
    ventureId: args.ventureId,
    runId: args.runId,
    schema,
    timeoutMs: T1_TIMEOUT_MS,
    estimatedOutputTokens: 3_000,
  });

  const cells = result.data.cells.map((cell) =>
    buildCellRow({
      candidateId: args.candidate.id,
      parameterKey: cell.parameter_key,
      tier: "universal",
      value: cell.value,
      citation: cell.citation,
      confidence: cell.confidence,
      reason: cell.reason ?? null,
      llmCallId: result.llmCallId,
    }),
  );

  return {
    cells,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    llmCallId: result.llmCallId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tier 2 — batched Opus + M13 citations
// ────────────────────────────────────────────────────────────────────────

async function runTier2Batch(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateRow;
  parameters: Parameter[];
  m13Citations: M13CitationInput[];
  runTimestamp: string;
  model: string;
  runId: string | null;
  ventureDescription: string;
}): Promise<TierRunResult> {
  if (args.parameters.length === 0) {
    return { cells: [], costUsd: 0, latencyMs: 0, llmCallId: "" };
  }

  const promptBody = await loadPrompt(PROMPT_T2);
  const prompt = assembleTier2Prompt(promptBody, {
    candidateName: args.candidate.name,
    candidateRationale: args.candidate.rationale,
    ventureDescription: args.ventureDescription,
    parameters: args.parameters,
    m13Citations: args.m13Citations,
    runTimestamp: args.runTimestamp,
  });

  const expectedKeys = args.parameters.map((p) => p.id);
  const schema = makeStrictTier2BatchSchema(expectedKeys);

  const result = await callLLM<Tier2BatchOutput>({
    insforge: args.insforge,
    model: args.model,
    stage: STAGE_T2,
    prompt,
    ventureId: args.ventureId,
    runId: args.runId,
    schema,
    timeoutMs: T2_TIMEOUT_MS,
    estimatedOutputTokens: 4_000,
  });

  // Two post-checks Zod can't do (it lacks per-call context):
  //   1. Citation URL must echo a supplied M13 URL.
  //   2. Per-parameter `citation_required` — when a parameter requires a
  //      citation and the model didn't provide one, downgrade to unknown
  //      rather than burning a retry. Parameters where
  //      `citation_required=false` (enum classifications like
  //      `customer_segment_type`) are accepted citation-less.
  const m13UrlSet = new Set(args.m13Citations.map((c) => c.url));
  const paramByKey = new Map(args.parameters.map((p) => [p.id, p]));
  const cells: CellRow[] = [];
  for (const cell of result.data.cells) {
    let citation = cell.citation;
    let confidence = cell.confidence;
    let value = cell.value;
    let reason: string | null = cell.reason ?? null;

    if (citation && !m13UrlSet.has(citation.url)) {
      reason = `citation_url_not_in_m13_set: ${citation.url}`;
      citation = null;
      value = null;
      confidence = "unknown";
    }

    if (
      confidence !== "unknown" &&
      citation === null &&
      paramByKey.get(cell.parameter_key)?.citation_required === true
    ) {
      // Parameter required a citation and model didn't supply one — the
      // value is suspect. Downgrade to unknown with a reason so the
      // dossier UI flags it for the consultant.
      reason = reason
        ? `${reason} | missing_required_citation`
        : "missing_required_citation";
      value = null;
      confidence = "unknown";
    }

    cells.push(
      buildCellRow({
        candidateId: args.candidate.id,
        parameterKey: cell.parameter_key,
        tier: "framework",
        value,
        citation,
        confidence,
        reason,
        llmCallId: result.llmCallId,
      }),
    );
  }

  return {
    cells,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    llmCallId: result.llmCallId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tier 3 — per-cell Exa + Sonnet, 3-concurrent
// ────────────────────────────────────────────────────────────────────────

async function runTier3Loop(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateRow;
  parameters: Parameter[];
  runTimestamp: string;
  model: string;
  runId: string | null;
}): Promise<TierRunResult> {
  if (args.parameters.length === 0) {
    return { cells: [], costUsd: 0, latencyMs: 0, llmCallId: "" };
  }

  const promptBody = await loadPrompt(PROMPT_T3);

  const limiter = createConcurrencyLimiter(T3_CONCURRENCY);
  const cellResults = await Promise.all(
    args.parameters.map((parameter) =>
      limiter(() =>
        runTier3SingleCell({
          insforge: args.insforge,
          ventureId: args.ventureId,
          candidate: args.candidate,
          parameter,
          promptBody,
          runTimestamp: args.runTimestamp,
          model: args.model,
          runId: args.runId,
        }),
      ),
    ),
  );

  const cells = cellResults.map((r) => r.cell);
  const costUsd = cellResults.reduce((acc, r) => acc + r.costUsd, 0);
  const latencyMs = cellResults.reduce((acc, r) => Math.max(acc, r.latencyMs), 0);

  return { cells, costUsd, latencyMs, llmCallId: "" };
}

interface Tier3SingleCellResult {
  cell: CellRow;
  costUsd: number;
  latencyMs: number;
}

async function runTier3SingleCell(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateRow;
  parameter: Parameter;
  promptBody: string;
  runTimestamp: string;
  model: string;
  runId: string | null;
}): Promise<Tier3SingleCellResult> {
  const start = Date.now();
  const initialQuery = buildTier3Query(args.parameter.prompt_hint, args.candidate.name);

  let exaResults: ExaSearchResult[] = [];
  let exaCostUsd = 0;

  try {
    const searchResult = await exaSearchWithBroadenRetry({
      query: initialQuery,
      numResults: 3,
      // M15-F1: anchor Tier 3 results on the candidate name. Without this,
      // neural search returns the strongest topical match regardless of
      // company — Vertiv/Eaton/Advanced Energy pages instead of Schneider's.
      includeText: args.candidate.name,
    });

    await logExaCall(args.insforge, {
      ventureId: args.ventureId,
      candidateId: args.candidate.id,
      parameterKey: args.parameter.id,
      stage: "stage_5_t3_initial",
      query: initialQuery,
      response: searchResult.initial,
    });

    if (searchResult.broadenedQuery && searchResult.broadened) {
      await logExaCall(args.insforge, {
        ventureId: args.ventureId,
        candidateId: args.candidate.id,
        parameterKey: args.parameter.id,
        stage: "stage_5_t3_broadened",
        query: searchResult.broadenedQuery,
        response: searchResult.broadened,
      });
    }

    // Exa pricing is a flat per-search rate at our tier (~$0.005). Tracked
    // here purely for the tier cost roll-up — actual billing comes from
    // Exa's monthly invoice.
    exaCostUsd =
      0.005 *
      (searchResult.initial ? 1 : 0) +
      0.005 * (searchResult.broadened ? 1 : 0);

    if (searchResult.response === null || searchResult.isEmpty) {
      // No usable evidence even after broadening → honest unknown.
      return {
        cell: buildCellRow({
          candidateId: args.candidate.id,
          parameterKey: args.parameter.id,
          tier: "dynamic",
          value: null,
          citation: null,
          confidence: "unknown",
          reason: "no_evidence_found",
          llmCallId: null,
        }),
        costUsd: exaCostUsd,
        latencyMs: Date.now() - start,
      };
    }

    exaResults = searchResult.response.results;
  } catch (exaErr) {
    if (!(exaErr instanceof ExaError)) throw exaErr;
    // Exa transient failure → record cell as unknown rather than failing
    // the entire run. The error is in exa_call_logs for audit.
    return {
      cell: buildCellRow({
        candidateId: args.candidate.id,
        parameterKey: args.parameter.id,
        tier: "dynamic",
        value: null,
        citation: null,
        confidence: "unknown",
        reason: `exa_error: ${exaErr.message.slice(0, 200)}`,
        llmCallId: null,
      }),
      costUsd: 0,
      latencyMs: Date.now() - start,
    };
  }

  // Extraction call with Sonnet.
  const prompt = assembleTier3Prompt(args.promptBody, {
    candidateName: args.candidate.name,
    parameter: args.parameter,
    exaResults,
    runTimestamp: args.runTimestamp,
  });

  try {
    const llmResult = await callLLM<Tier3CellOutput>({
      insforge: args.insforge,
      model: args.model,
      stage: STAGE_T3,
      prompt,
      ventureId: args.ventureId,
      runId: args.runId,
      schema: Tier3CellOutputSchema,
      timeoutMs: T3_TIMEOUT_MS,
      estimatedOutputTokens: 400,
    });

    // Post-check: citation URL must be in the supplied Exa set.
    const exaUrlSet = new Set(exaResults.map((r) => r.url));
    let { value, citation, confidence } = llmResult.data;
    let reason: string | null = llmResult.data.reason ?? null;

    if (citation && !exaUrlSet.has(citation.url)) {
      reason = `citation_url_not_in_exa_set: ${citation.url}`;
      citation = null;
      value = null;
      confidence = "unknown";
    }

    return {
      cell: buildCellRow({
        candidateId: args.candidate.id,
        parameterKey: args.parameter.id,
        tier: "dynamic",
        value,
        citation,
        confidence,
        reason,
        llmCallId: llmResult.llmCallId,
      }),
      costUsd: exaCostUsd + llmResult.costUsd,
      latencyMs: Date.now() - start,
    };
  } catch (llmErr) {
    // Extraction failure (validation, timeout, etc.) → cell becomes unknown
    // rather than failing the whole tier. Other cells continue.
    return {
      cell: buildCellRow({
        candidateId: args.candidate.id,
        parameterKey: args.parameter.id,
        tier: "dynamic",
        value: null,
        citation: null,
        confidence: "unknown",
        reason: `extraction_error: ${errorMessage(llmErr).slice(0, 200)}`,
        llmCallId: null,
      }),
      costUsd: exaCostUsd,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Minimal in-flight concurrency limiter — equivalent to p-limit without the
 * dependency. Caller-supplied async factory is invoked when a slot opens; we
 * return a promise that resolves with whatever the factory resolves to.
 */
function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return function <T>(factory: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tryRun = () => {
        if (active >= maxConcurrent) {
          queue.push(tryRun);
          return;
        }
        active += 1;
        factory()
          .then((result) => {
            resolve(result);
          })
          .catch((err) => {
            reject(err);
          })
          .finally(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
      };
      tryRun();
    });
  };
}

// ────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ────────────────────────────────────────────────────────────────────────

interface Tier1PromptInput {
  candidateName: string;
  candidateRationale: string;
  ventureDescription: string;
  parameters: Parameter[];
}

/** @internal Exported for tests. */
export function assembleTier1Prompt(
  promptBody: string,
  input: Tier1PromptInput,
): string {
  const stripped = promptBody.replace(PROMPT_INPUT_PLACEHOLDER, "").trimEnd();
  return [
    stripped,
    "",
    "## Venture context (anonymised)",
    "",
    input.ventureDescription,
    "",
    "## Candidate",
    "",
    `**Name:** ${input.candidateName}`,
    "",
    `**Why M13 picked it:** ${input.candidateRationale}`,
    "",
    "## Tier 1 parameters",
    "",
    "```json",
    JSON.stringify(input.parameters, null, 2),
    "```",
    "",
  ].join("\n");
}

interface Tier2PromptInput extends Tier1PromptInput {
  m13Citations: M13CitationInput[];
  runTimestamp: string;
}

/** @internal Exported for tests. */
export function assembleTier2Prompt(
  promptBody: string,
  input: Tier2PromptInput,
): string {
  const stripped = promptBody.replace(PROMPT_INPUT_PLACEHOLDER, "").trimEnd();
  const citationLines: string[] = [];
  if (input.m13Citations.length === 0) {
    citationLines.push(
      "(No citations available for this candidate — all cells should likely be `confidence='unknown'`.)",
    );
  } else {
    for (const c of input.m13Citations) {
      const tag = c.source === "t2_presearch" ? "[T2-presearch]" : "[M13]";
      citationLines.push(
        `[${c.id}] ${tag} url: ${c.url}`,
        `     title: ${c.title}`,
        `     query: ${c.query}`,
      );
      if (c.snippet) {
        // Cap inline snippet at ~400 chars to keep prompt size manageable.
        const compact = c.snippet.replace(/\s+/gu, " ").trim().slice(0, 400);
        citationLines.push(`     snippet: ${compact}${c.snippet.length > 400 ? "…" : ""}`);
      }
    }
  }

  return [
    stripped,
    "",
    "## Venture context (anonymised)",
    "",
    input.ventureDescription,
    "",
    "## Candidate",
    "",
    `**Name:** ${input.candidateName}`,
    "",
    `**Why M13 picked it:** ${input.candidateRationale}`,
    "",
    "## M13 citations (the ONLY valid citation URLs for this call)",
    "",
    citationLines.join("\n"),
    "",
    `Use \`retrieved_at: "${input.runTimestamp}"\` when echoing a citation.`,
    "",
    "## Tier 2 parameters",
    "",
    "```json",
    JSON.stringify(input.parameters, null, 2),
    "```",
    "",
  ].join("\n");
}

interface Tier3PromptInput {
  candidateName: string;
  parameter: Parameter;
  exaResults: ExaSearchResult[];
  runTimestamp: string;
}

/** @internal Exported for tests. */
export function assembleTier3Prompt(
  promptBody: string,
  input: Tier3PromptInput,
): string {
  const stripped = promptBody.replace(PROMPT_INPUT_PLACEHOLDER, "").trimEnd();
  const resultLines: string[] = [];
  for (let i = 0; i < input.exaResults.length; i++) {
    const r = input.exaResults[i]!;
    resultLines.push(
      `### Result ${i + 1}`,
      `- **url:** ${r.url}`,
      `- **title:** ${r.title}`,
      `- **retrieved_at:** ${input.runTimestamp}`,
      `- **snippet:**`,
      "",
      r.text,
      "",
    );
  }

  return [
    stripped,
    "",
    "## Candidate",
    "",
    input.candidateName,
    "",
    "## Tier 3 parameter (one)",
    "",
    "```json",
    JSON.stringify(input.parameter, null, 2),
    "```",
    "",
    "## Exa search results (the ONLY valid citation URLs)",
    "",
    resultLines.length > 0 ? resultLines.join("\n") : "(no results)",
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Row builder + DB writers
// ────────────────────────────────────────────────────────────────────────

function buildCellRow(args: {
  candidateId: string;
  parameterKey: string;
  tier: ParameterTier;
  value: unknown;
  citation: CellCitation | null;
  confidence: "verified" | "inferred" | "unknown";
  reason: string | null;
  llmCallId: string | null;
}): CellRow {
  const row = {
    candidate_id: args.candidateId,
    parameter_key: args.parameterKey,
    tier: args.tier,
    value: args.value ?? null,
    citation: args.citation,
    confidence: args.confidence,
    reason: args.reason,
    // Empty string sentinel → null. callLLM returns "" for the llmCallId of
    // tier-runs that didn't make a model call (T3 cells that fell through
    // to unknown before extraction).
    llm_call_id: args.llmCallId && args.llmCallId.length > 0 ? args.llmCallId : null,
  };
  // CellRowSchema enforces the confidence × value × citation invariants.
  // Throw early here so we don't write a malformed row.
  return CellRowSchema.parse(row);
}

async function insertCells(
  insforge: InsForgeClient,
  cells: CellRow[],
): Promise<void> {
  if (cells.length === 0) return;
  // UPSERT semantics not exposed in @insforge/sdk consistently — V1
  // policy is latest-write-wins via the unique constraint. If the orchestrator
  // is re-run on the same candidate, delete-then-insert is the simplest
  // path. M15.1 may switch to an UPSERT or a cell_research_runs audit table.
  const parameterKeys = cells.map((c) => c.parameter_key);
  const candidateId = cells[0]!.candidate_id;

  await insforge.database
    .from("cells")
    .delete()
    .eq("candidate_id", candidateId)
    .in("parameter_key", parameterKeys);

  const { error } = await insforge.database.from("cells").insert(cells);
  if (error) {
    throw new OrchestratorError(`Failed to insert cells: ${error.message}`);
  }
}

async function markCellsReady(
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

// ────────────────────────────────────────────────────────────────────────
// Exa call logging
// ────────────────────────────────────────────────────────────────────────

async function logExaCall(
  insforge: InsForgeClient,
  args: {
    ventureId: string;
    candidateId: string;
    /** Null for cross-cell pre-search (M15-F2); set for per-cell T3 calls. */
    parameterKey: string | null;
    stage: string;
    query: string;
    response: { results: ExaSearchResult[]; latencyMs: number };
    error?: string;
  },
): Promise<void> {
  await insforge.database.from("exa_call_logs").insert([
    {
      venture_id: args.ventureId,
      candidate_id: args.candidateId,
      parameter_key: args.parameterKey,
      stage: args.stage,
      query: args.query,
      num_results: args.response.results.length,
      results: args.response.results,
      // Approx — see runTier3SingleCell for the per-cell rollup.
      cost_usd: 0.005,
      latency_ms: args.response.latencyMs,
      error: args.error ?? null,
    },
  ]);
}

// ────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────

function countUnknown(cells: CellRow[]): number {
  return cells.filter((c) => c.confidence === "unknown").length;
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof PreconditionError) return err.message;
  if (err instanceof TokenLimitError) {
    return `Cell research input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}).`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted: $${err.currentCostUsd.toFixed(4)} spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}.`;
  }
  if (err instanceof LLMValidationError) {
    return `Cell research model output failed validation after ${err.attempts} attempt(s).`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Cell research OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof ExaError) {
    return `Exa search failed: ${err.message}`;
  }
  if (err instanceof OrchestratorError) return err.message;
  return errorMessage(err);
}
