import { randomUUID } from "node:crypto";

import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "@/lib/openrouter/errors";
import { loadPrompt } from "@/lib/prompts";
import {
  computeAggregateScore,
  type DimensionWeights,
} from "@/lib/scoring/aggregate";
import { errorMessage } from "@/lib/utils";
import {
  DIMENSION_KEYS,
  Stage6CandidateScoringOutputSchema,
  type Stage6CandidateScoringOutput,
} from "@/types/candidate-scoring";
import {
  VentureProfileSchema,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_6_score";

// One candidate's evidence table is ~3-6k tokens of input; the output is 7
// short rationales. 90s gives Opus comfortable headroom per candidate.
const STAGE_6_TIMEOUT_MS = 90_000;

const DEFAULT_STAGE_6_MODEL = "anthropic/claude-opus-4.7";

// Candidates below this many evidenced cells (non-null value, confidence
// verified/inferred) are skipped, not scored. Scoring them would recreate the
// pre-research guessing problem this stage exists to eliminate: the whole
// point of scoring AFTER cell research is that the rank reflects facts.
const MIN_EVIDENCE_CELLS = 5;

// Per-candidate scoring calls run concurrently. 3 mirrors Stage 5's
// within-venture cap; scoring is Opus-only (no Exa), so the limit is about
// OpenRouter throughput, not search rate limits.
const SCORING_CONCURRENCY = 3;

// Evidence-digest budget guards. Long prose values are truncated per cell and
// the digest is capped overall so a pathological cells table can't blow the
// context window.
const MAX_VALUE_CHARS = 600;
const MAX_EVIDENCE_CHARS = 40_000;

const APPEND_PLACEHOLDER =
  /\[The VentureX profile, candidate, and evidence table will be appended below\]\s*$/;

/**
 * @public
 * Input to {@link runStage6Scoring}.
 */
export interface RunStage6ScoringInput {
  ventureId: string;
  insforge: InsForgeClient;
  /** When true, run the LLM calls but skip the candidate_companies writes. */
  dryRun?: boolean;
}

/** @public One successfully scored candidate. */
export interface ScoredCandidateSummary {
  candidateId: string;
  name: string;
  aggregateScore: number;
  output: Stage6CandidateScoringOutput;
}

/**
 * @public
 * Result of {@link runStage6Scoring}.
 *
 * Stage 6 is an out-of-band enrichment pass: it never touches
 * `ventures.status` (unlike Stages 1-5), so a scoring failure can't wedge the
 * pipeline state machine. Per-candidate failures are collected rather than
 * failing the batch — mirroring Stage 5's per-candidate isolation.
 */
export type RunStage6ScoringResult =
  | {
      ok: true;
      runId: string;
      scored: ScoredCandidateSummary[];
      skipped: { candidateId: string; name: string; reason: string }[];
      failed: { candidateId: string; name: string; error: string }[];
      costUsd: number;
    }
  | { ok: false; error: string };

interface CandidateRow {
  id: string;
  name: string;
  type: string;
  rationale: string;
  generation_run_id: string;
  created_at: string;
}

interface CellEvidenceRow {
  candidate_id: string;
  parameter_key: string;
  tier: string;
  value: unknown;
  confidence: string;
}

interface DimensionWeightRow {
  dimension: string;
  weight: number | string;
  created_at: string;
}

/**
 * @public
 * Stage 6: score every researched candidate against the venture's 7
 * dimensions using the candidate's researched cells as evidence, compute the
 * weighted aggregate (P3-D16: Σ scoreᵢ × weightᵢ over the canonical
 * dimension_weights set), and persist both to `candidate_companies`
 * (migration 0005 columns). The comparison table ranks its columns by
 * `aggregate_score`.
 *
 * Runs after cell research by design — see the 2026-07-09 decision: analyse
 * suitability AFTER the facts are collected, not before. Candidates without
 * enough researched evidence are skipped (never guessed at) and sort after
 * scored candidates in the table.
 *
 * Budget: mints a fresh run UUID per invocation so the per-run cost cap
 * applies to this scoring pass in isolation. Reusing `ventures.current_run_id`
 * would inherit the full pipeline's accumulated spend and starve the pass —
 * the same collision that truncated large Stage 5 batches.
 *
 * Re-run semantics: idempotent overwrite. Each scored candidate's
 * `dimension_scores` + `aggregate_score` are UPDATEd in place (the columns
 * are derived data, not audit trail — the audit trail is `llm_call_logs`).
 */
export async function runStage6Scoring(
  input: RunStage6ScoringInput,
): Promise<RunStage6ScoringResult> {
  const { ventureId, insforge, dryRun = false } = input;
  const runId = randomUUID();

  try {
    const [profile, weights, candidates] = await Promise.all([
      loadLatestProfile(insforge, ventureId),
      loadCanonicalWeights(insforge, ventureId),
      loadLatestRunCandidates(insforge, ventureId),
    ]);

    if (!profile) {
      throw new OrchestratorError(
        "No profile found for this venture. Stage 1 must complete before scoring.",
      );
    }
    if (!weights) {
      throw new OrchestratorError(
        "No dimension weights found. Stage 2 must complete before scoring — the aggregate is weight-dependent.",
      );
    }
    if (candidates.length === 0) {
      throw new OrchestratorError(
        "No candidates found. Generate candidates before scoring.",
      );
    }

    const cellsByCandidate = await loadEvidenceCells(
      insforge,
      candidates.map((candidate) => candidate.id),
    );

    const promptBody = await loadPrompt("stage_6_candidate_scoring.md");
    const model = process.env.STAGE_6_MODEL ?? DEFAULT_STAGE_6_MODEL;

    const scored: ScoredCandidateSummary[] = [];
    const skipped: { candidateId: string; name: string; reason: string }[] = [];
    const failed: { candidateId: string; name: string; error: string }[] = [];
    let costUsd = 0;

    const limiter = createConcurrencyLimiter(SCORING_CONCURRENCY);

    await Promise.all(
      candidates.map((candidate) =>
        limiter(async () => {
          const cells = cellsByCandidate.get(candidate.id) ?? [];
          const evidenced = cells.filter(
            (cell) =>
              cell.confidence !== "unknown" &&
              cell.value !== null &&
              cell.value !== undefined,
          );

          if (evidenced.length < MIN_EVIDENCE_CELLS) {
            skipped.push({
              candidateId: candidate.id,
              name: candidate.name,
              reason:
                cells.length === 0
                  ? "not researched"
                  : `insufficient evidence (${evidenced.length} evidenced cells, need ${MIN_EVIDENCE_CELLS})`,
            });
            return;
          }

          try {
            const prompt = assembleScoringPrompt(
              promptBody,
              profile,
              candidate,
              cells,
            );

            const result = await callLLM<Stage6CandidateScoringOutput>({
              insforge,
              model,
              stage: STAGE,
              prompt,
              ventureId,
              runId,
              schema: Stage6CandidateScoringOutputSchema,
              timeoutMs: STAGE_6_TIMEOUT_MS,
            });
            costUsd += result.costUsd;

            const aggregate = computeAggregateScore(
              result.data.dimension_scores,
              weights,
            );

            if (!dryRun) {
              await persistScores(insforge, candidate.id, {
                dimensionScores: result.data.dimension_scores,
                aggregateScore: aggregate,
              });
            }

            scored.push({
              candidateId: candidate.id,
              name: candidate.name,
              aggregateScore: aggregate,
              output: result.data,
            });
          } catch (err) {
            failed.push({
              candidateId: candidate.id,
              name: candidate.name,
              error: formatErrorForUser(err),
            });
          }
        }),
      ),
    );

    // A run where nothing scored and something failed is a failure, not a
    // quiet success — surface the first error rather than an empty result.
    if (scored.length === 0 && failed.length > 0) {
      return {
        ok: false,
        error: `Scoring failed for all ${failed.length} researched candidate(s). First error: ${failed[0]!.error}`,
      };
    }
    if (scored.length === 0 && skipped.length === candidates.length) {
      return {
        ok: false,
        error:
          "No candidate has enough researched evidence to score. Run cell research first — scoring is evidence-based by design.",
      };
    }

    return { ok: true, runId, scored, skipped, failed, costUsd };
  } catch (err) {
    // No ventures.status stamp: scoring is out-of-band derived data and must
    // not wedge the pipeline state machine on failure.
    return { ok: false, error: formatErrorForUser(err) };
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

async function loadLatestProfile(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<VentureProfile | null> {
  // Prefer the human-refined profile; fall back to the raw extraction. Never
  // llm_critic — that row is flags on a profile, not a profile.
  for (const source of ["human_refined", "llm_extracted"]) {
    const { data, error } = await insforge.database
      .from("profile_versions")
      .select("id, profile_json")
      .eq("venture_id", ventureId)
      .eq("source", source)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new OrchestratorError(
        `Failed to load profile_versions (source=${source}): ${error.message}`,
      );
    }
    if (data) {
      const parsed = VentureProfileSchema.safeParse(
        (data as { profile_json: unknown }).profile_json,
      );
      if (!parsed.success) {
        throw new OrchestratorError(
          `Stored profile (source=${source}) does not validate against the current schema: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    }
  }
  return null;
}

/**
 * Pattern X (P3-D4): canonical weights = latest row per dimension by
 * created_at, any source. Normalized to sum exactly 1.0 (the aggregate
 * helper rejects sums outside [0.95, 1.05]).
 */
async function loadCanonicalWeights(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<DimensionWeights | null> {
  const { data, error } = await insforge.database
    .from("dimension_weights")
    .select("dimension, weight, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new OrchestratorError(
      `Failed to load dimension_weights: ${error.message}`,
    );
  }

  const rows = (data as DimensionWeightRow[] | null) ?? [];
  if (rows.length === 0) return null;

  const latest = new Map<string, number>();
  for (const row of rows) {
    // Ascending created_at order means the last write per dimension wins.
    latest.set(row.dimension, Number(row.weight));
  }

  const weights = {} as DimensionWeights;
  let sum = 0;
  for (const dim of DIMENSION_KEYS) {
    const value = latest.get(dim);
    if (value === undefined || !Number.isFinite(value)) {
      throw new OrchestratorError(
        `dimension_weights is missing a row for '${dim}'. Stage 2 must complete before scoring.`,
      );
    }
    weights[dim] = value;
    sum += value;
  }

  if (sum <= 0) {
    throw new OrchestratorError(
      `dimension_weights sum to ${sum}; cannot normalize.`,
    );
  }
  for (const dim of DIMENSION_KEYS) {
    weights[dim] = weights[dim] / sum;
  }
  return weights;
}

async function loadLatestRunCandidates(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<CandidateRow[]> {
  const { data, error } = await insforge.database
    .from("candidate_companies")
    .select("id, name, type, rationale, generation_run_id, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new OrchestratorError(
      `Failed to load candidate_companies: ${error.message}`,
    );
  }

  const all = (data as CandidateRow[] | null) ?? [];
  const latestRunId = all.at(-1)?.generation_run_id ?? null;
  return latestRunId
    ? all.filter((candidate) => candidate.generation_run_id === latestRunId)
    : [];
}

async function loadEvidenceCells(
  insforge: InsForgeClient,
  candidateIds: string[],
): Promise<Map<string, CellEvidenceRow[]>> {
  const byCandidate = new Map<string, CellEvidenceRow[]>();
  if (candidateIds.length === 0) return byCandidate;

  // Same explicit pagination as table-data.ts: PostgREST hard-caps responses
  // at 1000 rows server-side, and a many-candidate venture exceeds that.
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await insforge.database
      .from("cells")
      .select("candidate_id, parameter_key, tier, value, confidence")
      .in("candidate_id", candidateIds)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      throw new OrchestratorError(`Failed to load cells: ${error.message}`);
    }
    const rows = (data as CellEvidenceRow[] | null) ?? [];
    for (const row of rows) {
      const existing = byCandidate.get(row.candidate_id) ?? [];
      existing.push(row);
      byCandidate.set(row.candidate_id, existing);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return byCandidate;
}

const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  direct: "direct",
  category: "category",
  same_problem_different_mechanism: "same problem, different mechanism",
};

function assembleScoringPrompt(
  promptBody: string,
  profile: VentureProfile,
  candidate: CandidateRow,
  cells: CellEvidenceRow[],
): string {
  const stripped = promptBody.replace(APPEND_PLACEHOLDER, "").trimEnd();

  const evidenced = cells.filter(
    (cell) =>
      cell.confidence !== "unknown" &&
      cell.value !== null &&
      cell.value !== undefined,
  );
  const noEvidence = cells.filter(
    (cell) => !evidenced.includes(cell),
  );

  let evidenceChars = 0;
  const evidenceLines: string[] = [];
  let truncatedRows = 0;
  for (const cell of evidenced) {
    const line = JSON.stringify({
      parameter: cell.parameter_key,
      tier: cell.tier,
      confidence: cell.confidence,
      value: truncateValue(cell.value),
    });
    if (evidenceChars + line.length > MAX_EVIDENCE_CHARS) {
      truncatedRows += 1;
      continue;
    }
    evidenceChars += line.length;
    evidenceLines.push(line);
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
    "## Candidate",
    "",
    `Name: ${candidate.name}`,
    `Category: ${CANDIDATE_TYPE_LABELS[candidate.type] ?? candidate.type}`,
    `Generation rationale: ${candidate.rationale}`,
    "",
    "## Researched evidence (one JSON object per line)",
    "",
    ...evidenceLines,
  ];

  if (truncatedRows > 0) {
    sections.push(
      "",
      `(${truncatedRows} additional evidence rows omitted for length.)`,
    );
  }

  if (noEvidence.length > 0) {
    sections.push(
      "",
      "## No evidence found (absence of evidence, not negative evidence)",
      "",
      noEvidence.map((cell) => cell.parameter_key).join(", "),
    );
  }

  sections.push("");
  return sections.join("\n");
}

/** Truncate long prose inside evidence values; keep structure intact. */
function truncateValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_VALUE_CHARS
      ? `${value.slice(0, MAX_VALUE_CHARS)} …[truncated]`
      : value;
  }
  if (Array.isArray(value)) return value.map(truncateValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = truncateValue(entry);
    }
    return out;
  }
  return value;
}

async function persistScores(
  insforge: InsForgeClient,
  candidateId: string,
  args: {
    dimensionScores: Stage6CandidateScoringOutput["dimension_scores"];
    aggregateScore: number;
  },
): Promise<void> {
  const { error } = await insforge.database
    .from("candidate_companies")
    .update({
      dimension_scores: args.dimensionScores,
      aggregate_score: args.aggregateScore,
    })
    .eq("id", candidateId);

  if (error) {
    throw new OrchestratorError(
      `Failed to persist scores for candidate ${candidateId}: ${error.message}`,
    );
  }
}

/** Same minimal p-limit-equivalent as stage5-cells.ts. */
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
          .then(resolve)
          .catch(reject)
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

function formatErrorForUser(err: unknown): string {
  if (err instanceof TokenLimitError) {
    return `Scoring input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}).`;
  }
  if (err instanceof BudgetExceededError) {
    return `Scoring-run budget exhausted: $${err.currentCostUsd.toFixed(4)} spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}.`;
  }
  if (err instanceof LLMValidationError) {
    return `Scoring model output failed validation after ${err.attempts} attempt(s).`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Scoring OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof OrchestratorError) {
    return err.message;
  }
  return errorMessage(err);
}
