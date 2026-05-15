import { promises as fs } from "node:fs";
import path from "node:path";

import {
  insertProfileVersion,
  ProfileVersionInsertError,
} from "@/lib/db/profile-versions";
import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "@/lib/openrouter/errors";
import { errorMessage } from "@/lib/utils";
import {
  Stage1CriticOutputSchema,
  VentureProfileSchema,
  type Stage1CriticOutput,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_1_critic";

// claude.md §12: Stage 1 gets a 180s timeout. The critic reads the same docs
// plus the profile JSON, so input size and latency are similar.
const STAGE_1_CRITIC_TIMEOUT_MS = 180_000;

// D3: on critic failure, wait 30s then retry once before soft-failing.
const STAGE_1_CRITIC_RETRY_DELAY_MS = 30_000;

// CLAUDE.md §9: critic must use a different model family than Stage 1 (Claude).
// GPT-5.5 is the spec default; swap via STAGE_1_CRITIC_MODEL env var.
const DEFAULT_STAGE_1_CRITIC_MODEL = "openai/gpt-5.5";

const DOCUMENTS_PLACEHOLDER =
  /\[The Stage 1 profile JSON and the source documents will be appended below\]\s*$/;

/**
 * @public
 * Input to {@link runStage1Critic}.
 */
export interface RunStage1CriticInput {
  ventureId: string;
  insforge: InsForgeClient;
}

/**
 * @public
 * Result of {@link runStage1Critic}. Tri-state via two layers:
 *   - `ok: true, criticStatus: 'success'` — critic ran and produced output;
 *     a new `profile_versions` row with `source='llm_critic'` was inserted;
 *     venture is in `awaiting_refinement` with `critic_status='success'`.
 *   - `ok: true, criticStatus: 'unavailable'` — D3 soft-fail. Both attempts
 *     failed (network / validation / etc). NO `profile_versions` row is
 *     inserted, but the venture still transitions to `awaiting_refinement`
 *     with `critic_status='unavailable'`. The HITL UI shows a yellow banner.
 *   - `ok: false` — hard failure (budget exceeded, profile-version insert
 *     failure, or DB write error). Venture is in `status='error'`. The user
 *     must re-run.
 *
 * The orchestrator does NOT throw; every failure path resolves to one of
 * these three shapes so the server-action layer stays mechanical.
 */
export type RunStage1CriticResult =
  | {
      ok: true;
      criticStatus: "success";
      profileVersionId: string;
      runId: string | null;
      costUsd: number;
      latencyMs: number;
    }
  | {
      ok: true;
      criticStatus: "unavailable";
      reason: string;
      attempts: number;
    }
  | { ok: false; error: string };

interface VentureDocRow {
  id: string;
  filename: string;
  parsed_markdown: string | null;
  parse_error: string | null;
}

interface VentureRow {
  id: string;
  current_run_id: string | null;
  venture_documents: VentureDocRow[];
}

/**
 * @public
 * Stage 1 Critic (M8). Runs AFTER {@link runStage1Extraction} has inserted
 * an `llm_extracted` profile_versions row and the venture is still in
 * `status='extracting'`.
 *
 * Flow:
 *   1. Load the venture + its `current_run_id` + the latest `llm_extracted`
 *      profile_versions row + the parsed source documents.
 *   2. Assemble the critic prompt: prompt body + profile JSON + source docs.
 *   3. Try `callLLM` once with the critic model. On any error, wait 30s and
 *      try again. After two failed attempts: soft-fail (D3).
 *   4. On success: insert a `profile_versions` row with `source='llm_critic'`,
 *      set `critic_status='success'`, transition `status='awaiting_refinement'`.
 *   5. On soft-fail: set `critic_status='unavailable'`, transition to
 *      `awaiting_refinement` anyway so the human can refine without critic flags.
 *   6. On hard error (budget exceeded, insert failure): set `status='error'`.
 *
 * Budget: the critic reuses the extraction's `runId` so the per-run $5 cap
 * (D4) covers Stage 1 + critic together. BudgetExceededError is a HARD error,
 * not a soft-fail — D4 explicitly says "halt and require explicit user retry"
 * for budget exhaustion.
 */
export async function runStage1Critic(
  input: RunStage1CriticInput,
): Promise<RunStage1CriticResult> {
  const { ventureId, insforge } = input;

  try {
    const { runId, latestExtracted, docs } = await loadCriticInputs(
      insforge,
      ventureId,
    );

    if (!latestExtracted) {
      throw new OrchestratorError(
        "No llm_extracted profile_versions row found for this venture. Run Stage 1 extraction first.",
      );
    }
    if (docs.length === 0) {
      throw new OrchestratorError(
        "No parsed documents available on this venture; critic cannot compare profile claims to source evidence.",
      );
    }

    const promptBody = await loadCriticPrompt();
    const prompt = assembleCriticPrompt(promptBody, latestExtracted, docs);

    const model =
      process.env.STAGE_1_CRITIC_MODEL ?? DEFAULT_STAGE_1_CRITIC_MODEL;

    // D3: try once → 30s wait → retry → soft-fail.
    const { result, lastError, attempts } = await callWithD3Retry({
      insforge,
      model,
      prompt,
      ventureId,
      runId,
      docs,
    });

    if (!result) {
      // Soft-fail path. BudgetExceededError is the one exception — that's a
      // hard halt per D4 and is rethrown by callWithD3Retry; everything else
      // here is genuine flakiness or persistent validation failure.
      await transitionAfterCritic(insforge, ventureId, "unavailable");
      return {
        ok: true,
        criticStatus: "unavailable",
        reason: formatErrorForUser(lastError),
        attempts,
      };
    }

    let row;
    try {
      row = await insertProfileVersion(insforge, {
        ventureId,
        source: "llm_critic",
        profileJson: result.data,
        llmCallId: result.llmCallId,
      });
    } catch (err) {
      throw err;
    }

    await transitionAfterCritic(insforge, ventureId, "success");

    return {
      ok: true,
      criticStatus: "success",
      profileVersionId: row.id,
      runId,
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

interface CallWithD3RetryArgs {
  insforge: InsForgeClient;
  model: string;
  prompt: string;
  ventureId: string;
  runId: string | null;
  docs: VentureDocRow[];
}

interface CallWithD3RetryResult {
  result: Awaited<ReturnType<typeof callLLM<Stage1CriticOutput>>> | null;
  lastError: unknown;
  attempts: number;
}

/**
 * D3 retry harness: try once, wait 30s, try again. Budget exhaustion and
 * token-limit errors are NOT retried — they propagate so the caller fails
 * hard per D4. Everything else (network errors, LLM validation failure,
 * orchestrator-level errors) gets the second chance.
 */
async function callWithD3Retry(
  args: CallWithD3RetryArgs,
): Promise<CallWithD3RetryResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await callLLM<Stage1CriticOutput>({
        insforge: args.insforge,
        model: args.model,
        stage: STAGE,
        prompt: args.prompt,
        ventureId: args.ventureId,
        runId: args.runId,
        schema: Stage1CriticOutputSchema,
        timeoutMs: STAGE_1_CRITIC_TIMEOUT_MS,
        inputDocuments: args.docs.map((d) => ({
          filename: d.filename,
          doc_id: d.id,
        })),
      });
      return { result, lastError: null, attempts: attempt };
    } catch (err) {
      lastError = err;

      // D4: budget exhaustion halts immediately. Same for token-cap errors —
      // a retry would also exceed the cap. Rethrow so the orchestrator's
      // outer catch puts the venture in `status='error'`.
      if (err instanceof BudgetExceededError || err instanceof TokenLimitError) {
        throw err;
      }

      // Last attempt: don't sleep, just return the soft-fail signal.
      if (attempt >= 2) break;

      await sleep(STAGE_1_CRITIC_RETRY_DELAY_MS);
    }
  }

  return { result: null, lastError, attempts: 2 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCriticInputs(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{
  runId: string | null;
  latestExtracted: VentureProfile | null;
  docs: VentureDocRow[];
}> {
  const { data: ventureData, error: ventureError } = await insforge.database
    .from("ventures")
    .select(
      "id, current_run_id, venture_documents(id, filename, parsed_markdown, parse_error)",
    )
    .eq("id", ventureId)
    .single();

  if (ventureError || !ventureData) {
    throw new OrchestratorError(
      `Venture not found or inaccessible: ${ventureError?.message ?? "no row returned"}`,
    );
  }

  const venture = ventureData as unknown as VentureRow;
  const allDocs = venture.venture_documents ?? [];
  const usableDocs = allDocs.filter(
    (d) => !!d.parsed_markdown && !d.parse_error,
  );

  // Pull the most recent llm_extracted profile_versions row. We only critique
  // the LLM's extraction — not any human_refined or prior llm_critic row.
  const { data: profileRow, error: profileError } = await insforge.database
    .from("profile_versions")
    .select("profile_json")
    .eq("venture_id", ventureId)
    .eq("source", "llm_extracted")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) {
    throw new OrchestratorError(
      `Failed to load latest llm_extracted profile: ${profileError.message}`,
    );
  }

  let latestExtracted: VentureProfile | null = null;
  if (profileRow) {
    const candidate = (profileRow as { profile_json: unknown }).profile_json;
    // Validate before passing to the critic — if a row is structurally broken
    // we want to know now, not after burning a critic call on garbage input.
    const parsed = VentureProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new OrchestratorError(
        `Stored llm_extracted profile does not validate against current schema: ${parsed.error.message}`,
      );
    }
    latestExtracted = parsed.data;
  }

  return {
    runId: venture.current_run_id,
    latestExtracted,
    docs: usableDocs,
  };
}

async function loadCriticPrompt(): Promise<string> {
  // Read on every call. Iterating on the critic prompt is high-leverage
  // during M8 calibration; caching would force a server restart per edit.
  const promptPath = path.join(
    process.cwd(),
    "prompts",
    "stage_1_critic.md",
  );
  return fs.readFile(promptPath, "utf-8");
}

function assembleCriticPrompt(
  promptBody: string,
  profile: VentureProfile,
  docs: VentureDocRow[],
): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();

  const docBlocks = docs
    .map((d) => `## Document: ${d.filename}\n\n${d.parsed_markdown ?? ""}`)
    .join("\n\n");

  return [
    stripped,
    "",
    "## Profile under review (JSON)",
    "",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    "## Source documents",
    "",
    docBlocks,
    "",
  ].join("\n");
}

async function transitionAfterCritic(
  insforge: InsForgeClient,
  ventureId: string,
  criticStatus: "success" | "unavailable",
): Promise<void> {
  await insforge.database
    .from("ventures")
    .update({
      critic_status: criticStatus,
      status: "awaiting_refinement",
    })
    .eq("id", ventureId);
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof TokenLimitError) {
    return `Critic input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}). Split this venture or contact engineering.`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted before critic could complete: $${err.currentCostUsd.toFixed(4)} already spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}. Re-run from extraction to reset the budget.`;
  }
  if (err instanceof LLMValidationError) {
    return `Critic model output failed validation after ${err.attempts} attempt(s).`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Critic OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof ProfileVersionInsertError) {
    return `Failed to persist critic profile version: ${err.message}`;
  }
  if (err instanceof OrchestratorError) {
    return err.message;
  }
  return errorMessage(err);
}
