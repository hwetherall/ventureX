import { randomUUID } from "node:crypto";

import { ExaError } from "@/lib/exa/errors";
import { exaSearchBatch } from "@/lib/exa/search";
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
  Stage3CandidatesOutputSchema,
  type CandidateCompany,
  type Citation,
  type Stage3CandidatesOutput,
} from "@/types/candidate";
import {
  DIMENSION_KEYS,
  VentureProfileSchema,
  type Dimension,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_3_candidates";

// PHASE3.md §7: Stage 3 input is ≈8-10k tokens (profile JSON + weights JSON +
// the prompt body itself). Output is the bigger driver — 36-45 candidates
// with ~500-char rationales = ~4-5.5k output tokens, comparable to Stage 1's
// full profile JSON. At Opus 4.7's sustained ~40 tok/s generation, pure
// streaming time is 100-140s before TTFT and network overhead, so 90s cut
// off mid-stream on the first ABB run. Mirror Stage 1 at 180s.
const STAGE_3_TIMEOUT_MS = 180_000;

const DEFAULT_STAGE_3_MODEL = "anthropic/claude-opus-4.7";

// Matches the placeholder line at the end of prompts/stage_3_candidate_generation.md.
// The orchestrator strips it before appending the three input blocks (profile,
// weights, web evidence) so the prompt file stays self-documenting.
const DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON, dimension weights, and web evidence will be appended below\]\s*$/;

const PRECONDITION_STATUS = "ready" as const;
const IN_PROGRESS_STATUS = "candidates_generating" as const;
const SUCCESS_STATUS = "candidates_ready" as const;

/**
 * @public
 * Input to {@link runStage3Candidates}.
 */
export interface RunStage3CandidatesInput {
  ventureId: string;
  insforge: InsForgeClient;
}

/**
 * @public
 * Result of {@link runStage3Candidates}.
 *
 *   - `ok: true` — Stage 3 ran, 10-60 `candidate_companies` rows were inserted
 *     with a shared `generation_run_id`, venture is in `candidates_ready`.
 *   - `ok: false` — Hard failure (precondition violated, budget exhausted,
 *     validation failed, DB write failure). Venture status is `error`.
 *
 * The candidates UI reads the most recent `generation_run_id` for the venture
 * and renders that set; older runs stay as audit trail.
 */
export type RunStage3CandidatesResult =
  | {
      ok: true;
      generationRunId: string;
      profileVersionId: string;
      runId: string | null;
      candidateIds: string[];
      candidateCount: number;
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

interface InsertedCandidate {
  id: string;
}

/**
 * Canonical weight set passed to the prompt. One entry per dimension, with the
 * latest rationale (which may be null if a `human_adjusted` row dropped it).
 */
type CanonicalWeights = Record<
  Dimension,
  { weight: number; rationale: string | null; source: string }
>;

/**
 * One bundled web-search result set passed to the prompt. `query` echoes the
 * `implies_search_for` string verbatim so the model can attach citations with
 * the exact query string the schema demands.
 */
interface WebEvidenceBlock {
  query: string;
  results: { url: string; title: string; text: string }[];
}

/**
 * @public
 * Stage 3 (M13): web-augmented candidate brainstorm. Reads the latest
 * human-refined profile + canonical dimension_weights set, gathers web
 * evidence by running one Exa neural search per
 * `strategic_risks_and_uncertainties[].implies_search_for` (parallel), calls
 * Opus 4.7 with profile + weights + evidence, validates the output against
 * `Stage3CandidatesOutputSchema`, deduplicates within-run by case-folded
 * name (merging citations), and inserts 10-60 `candidate_companies` rows
 * sharing one `generation_run_id`. Candidates grounded in web evidence
 * carry up to 3 citations; training-data-only candidates carry no
 * citations. P3-D12: this path supersedes the M12 LLM-only flow.
 *
 * Concurrency guard (P3-D5, server-side half of belt-and-braces):
 *   - On entry, venture must be in `status='ready'`. The precondition is
 *     enforced atomically via a conditional UPDATE inside `claimReadyStatus`
 *     (`UPDATE ... WHERE status='ready'`) — so two concurrent invocations
 *     cannot both proceed even if they observed `status='ready'` at the
 *     same moment. Losing requests get PreconditionError; only one spends
 *     budget. Other rejected statuses include `candidates_generating` (a
 *     re-trigger mid-run) and `candidates_ready` (an already-completed run;
 *     the user should explicitly clear the existing set if they want a
 *     fresh brainstorm).
 *
 * Lifecycle:
 *   - On entry: status='ready' (any other status → error result without LLM call).
 *   - In flight: status='candidates_generating'.
 *   - On success: status='candidates_ready'.
 *   - On failure: status='error', error_message stamped.
 *
 * Re-runs: a subsequent invocation requires the user to clear the existing
 * candidate set (or transition status back to 'ready' manually). M12 ships
 * without a "regenerate candidates" affordance; M13 will add it once
 * web-augmented and LLM-only runs need to coexist.
 *
 * Budget: reuses `ventures.current_run_id` so the per-run $5 cap (D4) spans
 * Stages 1 + critic + 2 + 3. PHASE3.md §7 estimates Stage 3 at $0.20-0.40.
 */
export async function runStage3Candidates(
  input: RunStage3CandidatesInput,
): Promise<RunStage3CandidatesResult> {
  const { ventureId, insforge } = input;
  const generationRunId = randomUUID();

  try {
    // Atomic claim: closes the TOCTOU window between "read status='ready'"
    // and "write status='candidates_generating'" that a naive check-then-act
    // would leave open. Two concurrent invocations would otherwise both pass
    // the read, both transition, and both spend budget. The conditional
    // UPDATE collapses check + write into one operation; whichever request
    // wins gets `runId` back, the other gets PreconditionError.
    const runId = await claimReadyStatus(insforge, ventureId);

    // Inputs load AFTER the claim so a parallel-but-losing request doesn't
    // burn DB reads it can't use. If profile / weights load fails post-claim
    // the outer catch transitions venture to status='error', not back to
    // 'ready' — the user re-runs explicitly.
    const { profileVersion, weights } = await loadProfileAndWeights(
      insforge,
      ventureId,
    );

    // M13 web evidence step: one Exa neural search per implies_search_for
    // string, in parallel. ExaError propagates to the outer catch, where
    // formatErrorForUser surfaces it with the "Stage 3 web search failed"
    // prefix so the user can distinguish search failures from LLM failures.
    const webEvidence = await gatherWebEvidence(profileVersion.profile);

    const promptBody = await loadPrompt("stage_3_candidate_generation.md");
    const prompt = assembleStage3Prompt(
      promptBody,
      profileVersion.profile,
      weights,
      webEvidence,
    );

    const model = process.env.STAGE_3_MODEL ?? DEFAULT_STAGE_3_MODEL;

    const result = await callLLM<Stage3CandidatesOutput>({
      insforge,
      model,
      stage: STAGE,
      prompt,
      ventureId,
      runId,
      schema: Stage3CandidatesOutputSchema,
      timeoutMs: STAGE_3_TIMEOUT_MS,
      // The brainstorm output is larger than Stage 1/2 — 36-45 candidates ×
      // ~150 tokens each = ~6-7k completion tokens. Set the budget estimate
      // accordingly so the pre-call guardrail doesn't surprise-clip the run.
      estimatedOutputTokens: 7_000,
    });

    // Within-run dedup by case-folded name. The web-search step can surface
    // the same company under multiple implies_search_for hits, leading the
    // model to emit it under multiple candidate types. We keep the first
    // occurrence's type/rationale (model's primary placement) and merge
    // citation URLs from later duplicates, capping at 3 per candidate.
    const dedupedCandidates = dedupCandidates(result.data.candidates);

    const candidateIds = await insertCandidates(insforge, {
      ventureId,
      profileVersionId: profileVersion.id,
      generationRunId,
      llmCallId: result.llmCallId,
      candidates: dedupedCandidates,
    });

    await markCandidatesReady(insforge, ventureId);

    return {
      ok: true,
      generationRunId,
      profileVersionId: profileVersion.id,
      runId,
      candidateIds,
      candidateCount: candidateIds.length,
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

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

class PreconditionError extends Error {
  constructor(public readonly actualStatus: string) {
    super(
      `Stage 3 requires status='${PRECONDITION_STATUS}' on entry; venture is in status='${actualStatus}'. ` +
        `Complete Stage 2 weight confirmation first, or clear an existing candidate set before re-running.`,
    );
    this.name = "PreconditionError";
  }
}

class MissingWeightsError extends Error {
  constructor(public readonly missingDimensions: Dimension[]) {
    super(
      `Stage 3 requires a canonical weight for every dimension; missing: ${missingDimensions.join(", ")}. ` +
        `Run Stage 2 (dimension weighting) before Stage 3.`,
    );
    this.name = "MissingWeightsError";
  }
}

/**
 * Atomic precondition + transition: conditionally UPDATE `ventures` from
 * `status='ready'` to `status='candidates_generating'`. Returns the venture's
 * `current_run_id` on success (for downstream callLLM budget tracking).
 *
 * Closes the TOCTOU window inherent in check-then-act: a naive precondition
 * (read status → check 'ready' → write 'candidates_generating') lets two
 * concurrent requests both pass the read before either's write lands.
 * Postgres' MVCC serializes UPDATEs on the same row, so the conditional
 * UPDATE here is atomic — exactly one writer wins.
 *
 * Losing requests get PreconditionError. Hit-the-row-but-wrong-status cases
 * report the actual status by re-reading it after the UPDATE's zero-row
 * outcome (one extra read, only paid on the contention path).
 */
async function claimReadyStatus(
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
      `Failed to claim Stage 3 slot: ${error.message}`,
    );
  }

  const rows =
    (data as unknown as { id: string; current_run_id: string | null }[]) ?? [];
  if (rows.length === 0) {
    // Either the venture id doesn't exist (RLS or hard delete) or the
    // status precondition didn't hold. Read once to disambiguate so the
    // error message tells the user what went wrong.
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

async function loadProfileAndWeights(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{
  profileVersion: { id: string; profile: VentureProfile };
  weights: CanonicalWeights;
}> {
  const profile = await loadLatestProfileVersion(insforge, ventureId, [
    "human_refined",
    "llm_extracted",
  ]);

  if (!profile) {
    throw new OrchestratorError(
      "No profile_versions row found for this venture. Stage 1 must complete and the profile must be refined (or at least extracted) before Stage 3 runs.",
    );
  }

  const weights = await loadCanonicalWeights(insforge, ventureId);

  return { profileVersion: profile, weights };
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

/**
 * Pattern X (P3-D4): fetch all `dimension_weights` rows for the venture and
 * reduce to the latest per dimension by `created_at`. Latest wins regardless
 * of source — a `human_adjusted` row from the weights UI naturally supersedes
 * the earlier `llm_proposed` row from Stage 2.
 *
 * Throws MissingWeightsError if any dimension is absent. The Generate-candidates
 * button gates on status='ready' which implies Stage 2 has run + the human has
 * confirmed weights, so missing weights here represents a data-integrity
 * problem worth surfacing rather than papering over.
 *
 * Pattern Y (an explicit `weights_run_id` UUID column) is TODOS #9; this
 * orchestrator switches to that lookup once migration 0004 lands.
 */
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

  // Latest-per-dimension by created_at. <100 rows per venture in V1, so the
  // in-JS reduction is cheap; index work moves to Pattern Y later.
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


function assembleStage3Prompt(
  promptBody: string,
  profile: VentureProfile,
  weights: CanonicalWeights,
  webEvidence: WebEvidenceBlock[],
): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();

  // The weights block carries weight + rationale per dimension. The model uses
  // weight for tilt + rationale for context — see prompts/stage_3_*.md
  // "HOW TO USE THE DIMENSION WEIGHTS — SOFT TILT".
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

  const sections = [
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
    "Weights sum to ≈1.0. Each carries the rationale a human reviewer accepted.",
    "Use these as a *soft tilt*, not a filter — see the prompt body above.",
    "",
    "```json",
    JSON.stringify(weightsForPrompt, null, 2),
    "```",
    "",
  ];

  // The "## Web evidence" block is emitted even when empty so the model sees
  // a consistent prompt structure — an empty results array per query is more
  // legible than a missing section, and tells the model "we did search; no
  // hits came back" rather than "we forgot to search."
  sections.push(
    "## Web evidence",
    "",
    "Real Exa neural search results, one block per `implies_search_for`",
    "string from the venture profile. Use these to ground candidates that",
    "would otherwise be uncertain (regional players especially). When a",
    "candidate is supported by entries below, attach `citations` per the",
    "WEB EVIDENCE rules in the prompt body. Never invent URLs.",
    "",
    "```json",
    JSON.stringify(webEvidence, null, 2),
    "```",
    "",
  );

  return sections.join("\n");
}

/**
 * Success-path transition from `candidates_generating` to `candidates_ready`.
 * The IN_PROGRESS_STATUS write is owned by `claimReadyStatus` (atomic);
 * this helper handles the second leg only.
 *
 * No conditional check on entry — once a request has claimed the slot it
 * owns the venture for the rest of the call. A manual status override
 * mid-run by an admin is out of scope.
 */
async function markCandidatesReady(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<void> {
  // error_message clear is defensive: if a prior run failed and the user
  // then ran Stage 3 successfully, leaving stale error text would mislead.
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

async function insertCandidates(
  insforge: InsForgeClient,
  args: {
    ventureId: string;
    profileVersionId: string;
    generationRunId: string;
    llmCallId: string;
    candidates: CandidateCompany[];
  },
): Promise<string[]> {
  // Single insert with the full batch. The candidate_companies CHECK
  // constraints (type enum, dimensions_implicated bounds) provide
  // defense-in-depth around the Zod schema that callLLM already enforced.
  // Citations land as `null` when omitted (training-data candidates) or a
  // 1-3 element array when the model attached evidence; the schema enforced
  // shape upstream so no further validation here.
  const rows = args.candidates.map((c) => ({
    venture_id: args.ventureId,
    profile_version_id: args.profileVersionId,
    generation_run_id: args.generationRunId,
    name: c.name,
    type: c.type,
    rationale: c.rationale,
    dimensions_implicated: c.dimensions_implicated,
    citations: c.citations ?? null,
    llm_call_id: args.llmCallId,
  }));

  const { data, error } = await insforge.database
    .from("candidate_companies")
    .insert(rows)
    .select("id");

  if (error || !data) {
    throw new OrchestratorError(
      `Failed to insert candidate_companies rows: ${error?.message ?? "no rows returned"}`,
    );
  }

  return (data as InsertedCandidate[]).map((r) => r.id);
}

/**
 * Run one Exa neural search per `strategic_risks_and_uncertainties[]`
 * .implies_search_for string in parallel. Returns one
 * {@link WebEvidenceBlock} per risk, in the same order the risks appear in
 * the profile. Empty-result blocks are kept (the model sees "we searched;
 * found nothing here") rather than dropped.
 *
 * Empty input (a profile with no risks — unusual but possible if an extractor
 * regression produced a zero-risk profile) returns an empty array; the
 * prompt's `## Web evidence` block becomes an empty JSON array.
 *
 * Throws {@link ExaError} on any search failure. The outer orchestrator
 * `try/catch` transitions venture to status='error'; the user re-runs.
 */
async function gatherWebEvidence(
  profile: VentureProfile,
): Promise<WebEvidenceBlock[]> {
  const queries = profile.strategic_risks_and_uncertainties.map(
    (r) => r.implies_search_for,
  );

  if (queries.length === 0) {
    return [];
  }

  const responses = await exaSearchBatch(queries);

  return responses.map((r) => ({
    query: r.query,
    results: r.results.map((hit) => ({
      url: hit.url,
      title: hit.title,
      text: hit.text,
    })),
  }));
}

/**
 * Within-run de-duplication by case-folded name. PHASE3.md §8 warned that
 * M13's multi-search shape would surface the same company under multiple
 * queries; the model may then emit them as separate candidates (sometimes
 * under different types). We keep the first occurrence — that's the model's
 * primary categorization — and merge `citations` URLs from later duplicates,
 * de-duping by URL and capping at 3.
 *
 * Returns a fresh array, preserving the order of first occurrence. Inputs
 * are not mutated.
 */
function dedupCandidates(candidates: CandidateCompany[]): CandidateCompany[] {
  const seen = new Map<string, CandidateCompany>();

  for (const c of candidates) {
    const key = c.name.toLowerCase().trim();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, c);
      continue;
    }

    // Merge citations from this duplicate into the kept entry. Only the
    // citations field is merged; type / rationale / dimensions_implicated
    // stay as the first-occurrence model placement.
    if (!c.citations || c.citations.length === 0) {
      continue;
    }

    const existingUrls = new Set(
      (existing.citations ?? []).map((cit) => cit.url),
    );
    const newOnes: Citation[] = c.citations.filter(
      (cit) => !existingUrls.has(cit.url),
    );

    if (newOnes.length === 0) {
      continue;
    }

    const merged = [...(existing.citations ?? []), ...newOnes].slice(0, 3);
    seen.set(key, {
      ...existing,
      citations: merged.length > 0 ? merged : undefined,
    });
  }

  return Array.from(seen.values());
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof PreconditionError) {
    return err.message;
  }
  if (err instanceof MissingWeightsError) {
    return err.message;
  }
  if (err instanceof TokenLimitError) {
    return `Stage 3 input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}). The profile or weight rationales are unusually large; contact engineering.`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted before Stage 3 could complete: $${err.currentCostUsd.toFixed(4)} already spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}. Re-run from extraction to reset the budget.`;
  }
  if (err instanceof LLMValidationError) {
    return `Stage 3 model output failed validation after ${err.attempts} attempt(s). The candidate brainstorm did not match the expected schema; try again or inspect llm_call_logs for diagnostics.`;
  }
  if (err instanceof ExaError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Stage 3 web search failed${status}: ${err.message}. The Exa search step ran before the LLM call; no budget was spent on Opus. Verify EXA_API_KEY and retry.`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Stage 3 OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof OrchestratorError) {
    return err.message;
  }
  return errorMessage(err);
}
