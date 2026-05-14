/**
 * Per-token pricing estimates for the pre-call budget guardrail (USD per token).
 *
 * Source of truth for ACTUAL cost is OpenRouter's response — every successful
 * call writes the real cost into `llm_call_logs.cost_usd`. These constants
 * are used only for the pre-call estimate that gates D4's budget check.
 *
 * Verify these against OpenRouter's current pricing whenever a STAGE_*_MODEL
 * env var changes. The fallback below is intentionally pessimistic (Opus-tier)
 * so unknown models don't slip past the cap.
 */
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  // Claude family
  "anthropic/claude-opus-4.7": { input: 15e-6, output: 75e-6 },
  "anthropic/claude-opus-4.6": { input: 15e-6, output: 75e-6 },
  "anthropic/claude-sonnet-4.6": { input: 3e-6, output: 15e-6 },
  "anthropic/claude-haiku-4.5": { input: 1e-6, output: 5e-6 },

  // OpenAI family
  "openai/gpt-5.5": { input: 10e-6, output: 50e-6 },
  "openai/gpt-5": { input: 10e-6, output: 40e-6 },

  // Google family
  "google/gemini-2.5-pro": { input: 7e-6, output: 28e-6 },

  // xAI family
  "x-ai/grok-4": { input: 5e-6, output: 25e-6 },
};

/** Pessimistic fallback when a model is not in the table. */
export const UNKNOWN_MODEL_FALLBACK = { input: 15e-6, output: 75e-6 };

export function getPricing(modelId: string) {
  return MODEL_PRICING[modelId] ?? UNKNOWN_MODEL_FALLBACK;
}

export function estimateCostUsd(
  modelId: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): number {
  const { input, output } = getPricing(modelId);
  return estimatedInputTokens * input + estimatedOutputTokens * output;
}
