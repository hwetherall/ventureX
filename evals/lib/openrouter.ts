/**
 * DB-less OpenRouter caller for the eval framework.
 *
 * Why a separate copy from `src/lib/openrouter/call.ts`: the production
 * wrapper is coupled to InsForge (writes `llm_call_logs` rows, enforces a
 * per-run budget by reading prior costs from the DB, requires a venture
 * row). The eval framework intentionally runs without any DB so it can
 * regression-test prompt + schema changes in isolation, even before any
 * InsForge project is provisioned.
 *
 * Shared behavior with the production wrapper:
 *   - JSON extraction (fenced ```json … ``` or greedy first-`{` / last-`}`)
 *   - Zod validation
 *   - Retry-once with a corrective system reminder on validation failure
 *
 * Differences:
 *   - No `llm_call_logs` writes
 *   - No budget enforcement (just prints cost; caller can wrap with limits)
 *   - No `runId` plumbing — irrelevant without DB
 */

import type { ZodSchema } from "zod";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface DirectCallOptions<T> {
  model: string;
  prompt: string;
  schema: ZodSchema<T>;
  timeoutMs?: number;
  /** Visible in OpenRouter dashboards as the request title. */
  title?: string;
}

export interface DirectCallResult<T> {
  data: T;
  rawResponse: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  attempts: number;
}

interface OpenRouterResponse {
  choices: { message: { content: string }; finish_reason: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

export async function callOpenRouterDirect<T>(
  opts: DirectCallOptions<T>,
): Promise<DirectCallResult<T>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing from environment");

  const timeoutMs = opts.timeoutMs ?? 120_000;
  let currentPrompt = opts.prompt;
  let aggregateTokensIn = 0;
  let aggregateTokensOut = 0;
  let aggregateCost = 0;
  let totalLatency = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { response, latencyMs } = await callRaw({
      apiKey,
      model: opts.model,
      prompt: currentPrompt,
      timeoutMs,
      title: opts.title ?? "VentureX eval",
    });
    totalLatency += latencyMs;

    const rawResponse = response.choices[0]?.message.content;
    if (rawResponse === undefined || rawResponse === null) {
      throw new Error("OpenRouter returned no message content in choices[0]");
    }
    aggregateTokensIn += response.usage?.prompt_tokens ?? 0;
    aggregateTokensOut += response.usage?.completion_tokens ?? 0;
    aggregateCost += response.usage?.cost ?? 0;

    try {
      const parsed = extractAndParseJson(rawResponse);
      const data = opts.schema.parse(parsed);
      return {
        data,
        rawResponse,
        tokensIn: aggregateTokensIn,
        tokensOut: aggregateTokensOut,
        costUsd: aggregateCost,
        latencyMs: totalLatency,
        attempts: attempt,
      };
    } catch (validationError) {
      if (attempt >= 2) {
        throw new Error(
          `LLM output failed validation after 2 attempts: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
        );
      }
      currentPrompt = buildRetryPrompt(opts.prompt);
    }
  }

  throw new Error("Unreachable: exhausted validation retries without return");
}

async function callRaw(args: {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  title: string;
}): Promise<{ response: OpenRouterResponse; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": args.title,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: "user", content: args.prompt }],
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const response = (await res.json()) as OpenRouterResponse;
    return { response, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

function extractAndParseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Response contained no parseable JSON object");
  }
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
