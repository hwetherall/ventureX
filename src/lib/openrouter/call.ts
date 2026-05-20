import type { InsForgeClient } from "@/lib/insforge/server";
import type { ZodType, ZodTypeDef } from "zod";
import {
  BudgetExceededError,
  LLMValidationError,
  OpenRouterError,
  TokenLimitError,
} from "./errors";
import { estimateCostUsd } from "./pricing";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

// English-text heuristic: ~4 chars per token. Real tokenization (tiktoken)
// would be more accurate, but for a pre-call guardrail we just need a rough
// upper bound — the actual tokens come back in the response.
const CHARS_PER_TOKEN = 4;
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 2_000;

// Env-derived defaults resolved once at module load. Override per-call via args.
const ENV_MAX_INPUT_TOKENS = parseEnvInt("MAX_INPUT_TOKENS", 200_000);
const ENV_MAX_COST_USD_PER_RUN = parseEnvFloat("MAX_COST_USD_PER_RUN", 5);

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseEnvFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @public
 * Arguments for {@link callLLM}.
 *
 * Field naming: camelCase on the TS public surface. DB column names (snake_case)
 * are handled at the persistence boundary only.
 */
export interface CallLLMArgs<T> {
  insforge: InsForgeClient;
  model: string;
  /** Logical step name, e.g. 'stage_1_extract' / 'stage_1_critic' / 'stage_2_weight'. */
  stage: string;
  prompt: string;
  ventureId?: string | null;
  /** D4: groups calls within one Stage 1 + critic + Stage 2 cycle for budget tracking. */
  runId?: string | null;
  /**
   * Optional Zod schema. When set, response is parsed as JSON and validated.
   * Input type defaults to `unknown` so schemas wrapped with `z.preprocess`
   * (e.g., the M15 cell schemas that coerce empty values to null) remain
   * assignable here.
   */
  schema?: ZodType<T, ZodTypeDef, unknown>;
  /** If true (or schema present), response is parsed as JSON before optional Zod check. */
  expectJson?: boolean;
  maxInputTokens?: number;
  maxCostUsdPerRun?: number;
  timeoutMs?: number;
  /** Reference list captured into `llm_call_logs.input_documents` for audit. */
  inputDocuments?: { filename: string; doc_id?: string }[];
  /** Conservative output-token estimate for the pre-call cost guardrail. */
  estimatedOutputTokens?: number;
}

/**
 * @public
 * Result of a successful {@link callLLM}.
 *
 * Note: `tokensIn`, `tokensOut`, `costUsd`, and `latencyMs` describe the
 * **successful attempt only**. If validation failed on attempt 1 and succeeded
 * on the retry, these reflect the retry — earlier attempts are recorded against
 * the same `llmCallId` row in `llm_call_logs.error` for auditing but are not
 * accumulated into the totals returned here.
 */
export interface CallLLMResult<T> {
  data: T;
  rawResponse: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  llmCallId: string;
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** OpenRouter-specific: total cost in USD for this call. */
  cost?: number;
}

interface OpenRouterResponse {
  id: string;
  choices: { message: { content: string }; finish_reason: string }[];
  usage: OpenRouterUsage;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * @public
 * Single entry point for every LLM call in VentureX.
 *
 *   1. Pre-call: token + per-run budget guardrails (TokenLimitError, BudgetExceededError).
 *   2. Insert a placeholder llm_call_logs row so partial failures still leave a trace.
 *   3. POST to OpenRouter with a stage-appropriate timeout.
 *   4. Optional: parse JSON + validate against Zod schema.
 *   5. On JSON/Zod failure: retry ONCE with a corrective system reminder appended.
 *   6. Update the log row with response, tokens, cost, latency (or error).
 *
 * Retry-once is deliberately narrow: validation only. Network/API errors are
 * NOT retried by this wrapper — they propagate up so the caller can decide
 * whether to fail-soft (Stage 1 Critic per D3) or surface to the user.
 *
 * @throws {@link TokenLimitError} when the input exceeds `maxInputTokens`.
 * @throws {@link BudgetExceededError} when this call would push the run over `maxCostUsdPerRun`.
 * @throws {@link LLMValidationError} when both attempts fail JSON parse or Zod validation.
 * @throws {@link OpenRouterError} for network errors, non-2xx responses, timeouts.
 */
export async function callLLM<T = string>(
  args: CallLLMArgs<T>,
): Promise<CallLLMResult<T>> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInputTokens = args.maxInputTokens ?? ENV_MAX_INPUT_TOKENS;
  const maxCostPerRun = args.maxCostUsdPerRun ?? ENV_MAX_COST_USD_PER_RUN;
  const estimatedOutputTokens =
    args.estimatedOutputTokens ?? DEFAULT_ESTIMATED_OUTPUT_TOKENS;
  const wantsJson = args.expectJson === true || args.schema !== undefined;

  const estInputTokens = estimateTokens(args.prompt);
  if (estInputTokens > maxInputTokens) {
    throw new TokenLimitError(estInputTokens, maxInputTokens);
  }

  await checkPrecallBudget({
    insforge: args.insforge,
    runId: args.runId ?? null,
    model: args.model,
    estInputTokens,
    estimatedOutputTokens,
    maxCostPerRun,
  });

  const llmCallId = await insertPlaceholderLog(args);

  try {
    return await executeWithValidationRetry({
      args,
      llmCallId,
      timeoutMs,
      wantsJson,
    });
  } catch (error) {
    // Validation errors already stamped a per-attempt `error` field inside
    // executeWithValidationRetry. Don't overwrite that diagnostic message —
    // it tells us exactly which attempt failed and how. For anything else
    // (network / API / unexpected), stamp the error now so the log row
    // isn't orphaned.
    if (!(error instanceof LLMValidationError)) {
      await stampCallError(args.insforge, llmCallId, error);
    }
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * D4 pre-call budget check. Throws BudgetExceededError if the cumulative cost
 * of all calls in this `runId` plus this call's estimated cost would exceed
 * `maxCostPerRun`. No-ops when `runId` is null.
 */
async function checkPrecallBudget(params: {
  insforge: InsForgeClient;
  runId: string | null;
  model: string;
  estInputTokens: number;
  estimatedOutputTokens: number;
  maxCostPerRun: number;
}): Promise<void> {
  if (!params.runId) return;

  const { data: priorCalls, error: priorError } = await params.insforge.database
    .from("llm_call_logs")
    .select("cost_usd")
    .eq("run_id", params.runId);

  if (priorError) {
    throw new OpenRouterError(
      `Failed to read prior-run cost: ${priorError.message}`,
    );
  }

  const cumulative = (priorCalls ?? []).reduce(
    (sum: number, row: { cost_usd: number | null }) =>
      sum + (row.cost_usd ?? 0),
    0,
  );

  const estimatedCallCost = estimateCostUsd(
    params.model,
    params.estInputTokens,
    params.estimatedOutputTokens,
  );

  if (cumulative + estimatedCallCost > params.maxCostPerRun) {
    throw new BudgetExceededError(
      cumulative,
      params.maxCostPerRun,
      estimatedCallCost,
    );
  }
}

/** Inserts a placeholder llm_call_logs row and returns its id. */
async function insertPlaceholderLog<T>(args: CallLLMArgs<T>): Promise<string> {
  const { data, error } = await args.insforge.database
    .from("llm_call_logs")
    .insert([
      {
        venture_id: args.ventureId ?? null,
        run_id: args.runId ?? null,
        stage: args.stage,
        model_id: args.model,
        prompt_text: args.prompt,
        input_documents: args.inputDocuments ?? null,
      },
    ])
    .select("id")
    .single();

  if (error || !data) {
    throw new OpenRouterError(
      `Failed to insert llm_call_logs row: ${error?.message ?? "no row returned"}`,
    );
  }
  return (data as { id: string }).id;
}

/**
 * Runs the OpenRouter call with a single retry on validation failure (JSON parse
 * or Zod). Network/API errors propagate immediately. Stamps per-attempt error
 * details onto the log row inside the loop.
 */
async function executeWithValidationRetry<T>(params: {
  args: CallLLMArgs<T>;
  llmCallId: string;
  timeoutMs: number;
  wantsJson: boolean;
}): Promise<CallLLMResult<T>> {
  const { args, llmCallId, timeoutMs, wantsJson } = params;
  let currentPrompt = args.prompt;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { response, latencyMs } = await callOpenRouterRaw({
      model: args.model,
      prompt: currentPrompt,
      timeoutMs,
    });

    const rawResponse = response.choices[0]?.message.content;
    if (rawResponse === undefined || rawResponse === null) {
      throw new OpenRouterError(
        "OpenRouter returned no message content in choices[0]",
      );
    }

    const tokensIn = response.usage.prompt_tokens;
    const tokensOut = response.usage.completion_tokens;
    const costUsd =
      response.usage.cost ??
      estimateCostUsd(args.model, tokensIn, tokensOut);

    try {
      const data: T = wantsJson
        ? validateJsonResponse(rawResponse, args.schema)
        : (rawResponse as unknown as T);

      await finalizeSuccessLog({
        insforge: args.insforge,
        llmCallId,
        rawResponse,
        responseParsed: wantsJson ? (data as unknown) : null,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
      });

      return {
        data,
        rawResponse,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        llmCallId,
      };
    } catch (validationError) {
      await stampValidationFailure({
        insforge: args.insforge,
        llmCallId,
        attempt,
        rawResponse,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        validationError,
      });

      if (attempt >= 2) {
        throw new LLMValidationError(
          `LLM output validation failed after ${attempt} attempts`,
          attempt,
          validationError,
        );
      }

      currentPrompt = buildRetryPrompt(args.prompt);
    }
  }

  // Unreachable: the loop body always returns or throws.
  throw new LLMValidationError("Exhausted validation retries", 2, null);
}

function validateJsonResponse<T>(
  rawText: string,
  schema?: ZodType<T, ZodTypeDef, unknown>,
): T {
  const parsed = extractAndParseJson(rawText);
  return schema ? schema.parse(parsed) : (parsed as T);
}

function buildRetryPrompt(originalPrompt: string): string {
  return (
    originalPrompt +
    "\n\n# IMPORTANT — RETRY\n" +
    "Your previous response could not be parsed or did not match the required schema. " +
    "Return ONLY a single valid JSON object matching the schema above. " +
    "Do not include prose preamble or postamble, and do not wrap the JSON in code fences."
  );
}

async function finalizeSuccessLog(params: {
  insforge: InsForgeClient;
  llmCallId: string;
  rawResponse: string;
  responseParsed: unknown;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}): Promise<void> {
  await params.insforge.database
    .from("llm_call_logs")
    .update({
      response_text: params.rawResponse,
      response_parsed: params.responseParsed,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      cost_usd: params.costUsd,
      latency_ms: params.latencyMs,
    })
    .eq("id", params.llmCallId);
}

async function stampValidationFailure(params: {
  insforge: InsForgeClient;
  llmCallId: string;
  attempt: number;
  rawResponse: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  validationError: unknown;
}): Promise<void> {
  await params.insforge.database
    .from("llm_call_logs")
    .update({
      response_text: params.rawResponse,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      cost_usd: params.costUsd,
      latency_ms: params.latencyMs,
      error: `Validation failed (attempt ${params.attempt}): ${stringifyError(params.validationError)}`,
    })
    .eq("id", params.llmCallId);
}

async function stampCallError(
  insforge: InsForgeClient,
  llmCallId: string,
  error: unknown,
): Promise<void> {
  await insforge.database
    .from("llm_call_logs")
    .update({ error: `Call failed: ${stringifyError(error)}` })
    .eq("id", llmCallId);
}

async function callOpenRouterRaw(args: {
  model: string;
  prompt: string;
  timeoutMs: number;
}): Promise<{ response: OpenRouterResponse; latencyMs: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY not set in environment");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "VentureX",
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: "user", content: args.prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OpenRouterError(
        `OpenRouter returned ${res.status}: ${body.slice(0, 500)}`,
        res.status,
      );
    }

    const response = (await res.json()) as OpenRouterResponse;
    return { response, latencyMs: Date.now() - start };
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterError(
        `OpenRouter call timed out after ${args.timeoutMs}ms`,
      );
    }
    throw new OpenRouterError(
      `OpenRouter call failed: ${stringifyError(error)}`,
      undefined,
      error,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract a JSON object from an LLM response. Tolerates:
 *   - pure JSON
 *   - JSON wrapped in ```json ... ``` fences
 *   - JSON with prose around it (greedy first-`{` to last-`}`)
 *
 * The greedy fallback can occasionally match malformed JSON that happens to
 * start with `{` and end with `}`. Schema validation in the caller catches
 * those — but log when it triggers so we notice if it gets common.
 */
function extractAndParseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const trimmed = candidate.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Greedy fallback below.
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    console.warn(
      "[callLLM] extractAndParseJson fell back to greedy first-{/last-} match — model emitted prose around JSON",
    );
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Response contained no parseable JSON object");
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
