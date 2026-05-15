import { randomUUID } from "node:crypto";

import { insertProfileVersion, ProfileVersionInsertError } from "@/lib/db/profile-versions";
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
  VentureProfileSchema,
  type VentureProfile,
} from "@/types/venture-profile";

const STAGE = "stage_1_extract";

// claude.md §12: Stage 1 gets a 180s timeout. Frontier models on a ~10k-token
// ABB-scale corpus typically complete in 30-120s; this leaves headroom.
const STAGE_1_TIMEOUT_MS = 180_000;

const DEFAULT_STAGE_1_MODEL = "anthropic/claude-opus-4.7";

// Placeholder line that lives at the bottom of the prompt template. We strip
// it before appending the real document section so the LLM doesn't see two
// "## User-provided description" siblings next to dummy text.
const DOCUMENTS_PLACEHOLDER = /\[Documents will be appended here\]\s*$/;

/**
 * @public
 * Input to {@link runStage1Extraction}.
 */
export interface RunStage1ExtractionInput {
  ventureId: string;
  insforge: InsForgeClient;
}

/**
 * @public
 * Result of {@link runStage1Extraction}. Discriminated by `ok`. The caller
 * (server action) doesn't throw; it forwards `error` into UI state.
 */
export type RunStage1ExtractionResult =
  | {
      ok: true;
      profileVersionId: string;
      runId: string;
      costUsd: number;
      latencyMs: number;
    }
  | { ok: false; error: string };

interface VentureDocRow {
  id: string;
  filename: string;
  parsed_markdown: string | null;
  parse_error: string | null;
}

interface VentureWithDocs {
  id: string;
  user_provided_description: string;
  venture_documents: VentureDocRow[];
}

/**
 * @public
 * Stage 1: load the venture + its parsed documents, assemble the extraction
 * prompt per claude.md §8, call the configured frontier model with a Zod-
 * validated JSON contract, and persist the result as a `profile_versions`
 * row with `source='llm_extracted'`.
 *
 * Lifecycle:
 *   - On entry: assigns a fresh `current_run_id` (D4 budget tracking),
 *     clears `error_message`, sets `status='extracting'`, resets
 *     `critic_status='pending'`. Re-runs from `error` / `awaiting_refinement`
 *     start with a fresh $5 budget because no prior `llm_call_logs.run_id`
 *     matches the new UUID.
 *   - On success: leaves `status='extracting'` so the caller can chain into
 *     `runStage1Critic`. The critic is the one that transitions to
 *     `awaiting_refinement` (success OR D3 soft-fail).
 *   - On failure: transitions `status='error'`, stamps `error_message`.
 *     The user-facing message comes from {@link formatErrorForUser} so the
 *     UI can render it directly.
 *
 * Errors do not throw out of this function — every failure path resolves
 * to `{ ok: false, error }` so the server action layer stays mechanical.
 */
export async function runStage1Extraction(
  input: RunStage1ExtractionInput,
): Promise<RunStage1ExtractionResult> {
  const { ventureId, insforge } = input;
  const runId = randomUUID();

  const { error: resetError } = await insforge.database
    .from("ventures")
    .update({
      current_run_id: runId,
      status: "extracting",
      error_message: null,
      critic_status: "pending",
    })
    .eq("id", ventureId);

  if (resetError) {
    return {
      ok: false,
      error: `Failed to reset venture for new run: ${resetError.message}`,
    };
  }

  try {
    const { description, docs } = await loadVentureAndDocs(insforge, ventureId);

    if (docs.length === 0) {
      throw new OrchestratorError(
        "No parsed documents available on this venture. Upload at least one PDF or DOCX that parses without error.",
      );
    }

    const promptBody = await loadPrompt("stage_1_profile_extraction.md");
    const prompt = assemblePrompt(promptBody, description, docs);

    const model = process.env.STAGE_1_MODEL ?? DEFAULT_STAGE_1_MODEL;
    const result = await callLLM<VentureProfile>({
      insforge,
      model,
      stage: STAGE,
      prompt,
      ventureId,
      runId,
      schema: VentureProfileSchema,
      timeoutMs: STAGE_1_TIMEOUT_MS,
      inputDocuments: docs.map((d) => ({ filename: d.filename, doc_id: d.id })),
    });

    const row = await insertProfileVersion(insforge, {
      ventureId,
      source: "llm_extracted",
      profileJson: result.data,
      llmCallId: result.llmCallId,
    });

    // Status stays 'extracting' — the critic is responsible for transitioning
    // to 'awaiting_refinement' (claude.md §8 / D3). Caller chains immediately.

    return {
      ok: true,
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

/** Sentinel used for orchestration-layer failures that aren't from callLLM. */
class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

async function loadVentureAndDocs(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{ description: string; docs: VentureDocRow[] }> {
  const { data, error } = await insforge.database
    .from("ventures")
    .select(
      "id, user_provided_description, venture_documents(id, filename, parsed_markdown, parse_error)",
    )
    .eq("id", ventureId)
    .single();

  if (error || !data) {
    throw new OrchestratorError(
      `Venture not found or inaccessible: ${error?.message ?? "no row returned"}`,
    );
  }

  const venture = data as unknown as VentureWithDocs;
  const allDocs = venture.venture_documents ?? [];
  const usableDocs = allDocs.filter(
    (d) => !!d.parsed_markdown && !d.parse_error,
  );

  return { description: venture.user_provided_description, docs: usableDocs };
}

function assemblePrompt(
  promptBody: string,
  description: string,
  docs: VentureDocRow[],
): string {
  const stripped = promptBody
    .replace(DOCUMENTS_PLACEHOLDER, "")
    .trimEnd();

  const docBlocks = docs
    .map((d) => `## Document: ${d.filename}\n\n${d.parsed_markdown ?? ""}`)
    .join("\n\n");

  return [
    stripped,
    "",
    "## User-provided description",
    "",
    description,
    "",
    docBlocks,
    "",
  ].join("\n");
}

function formatErrorForUser(err: unknown): string {
  if (err instanceof TokenLimitError) {
    return `Input exceeds the ${err.capTokens.toLocaleString()}-token cap (estimated ${err.estimatedTokens.toLocaleString()}). Split this venture or contact engineering.`;
  }
  if (err instanceof BudgetExceededError) {
    return `Run budget exhausted: $${err.currentCostUsd.toFixed(4)} already spent; next call est. $${err.estimatedNextCostUsd.toFixed(4)} would exceed cap $${err.capUsd.toFixed(2)}. Re-run to start a fresh $${err.capUsd.toFixed(0)} budget.`;
  }
  if (err instanceof LLMValidationError) {
    return `Stage 1 model output failed validation after ${err.attempts} attempt(s). Inspect llm_call_logs for this venture and tighten the prompt before retrying.`;
  }
  if (err instanceof OpenRouterError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `OpenRouter call failed${status}: ${err.message}`;
  }
  if (err instanceof ProfileVersionInsertError) {
    return `Failed to persist profile version: ${err.message}`;
  }
  if (err instanceof OrchestratorError) {
    return err.message;
  }
  return errorMessage(err);
}
