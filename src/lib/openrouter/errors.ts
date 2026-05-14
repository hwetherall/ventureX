/**
 * D4: thrown when a pre-call cost estimate would push the current run over
 * `MAX_COST_USD_PER_RUN`. The caller surfaces this as venture status='error'
 * with a "Reset & Retry" CTA in the UI.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly currentCostUsd: number,
    public readonly capUsd: number,
    public readonly estimatedNextCostUsd: number,
  ) {
    super(
      `Run budget exceeded: current $${currentCostUsd.toFixed(4)} + estimated ` +
        `$${estimatedNextCostUsd.toFixed(4)} would exceed cap $${capUsd.toFixed(2)}`,
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * Thrown pre-call when combined input would exceed the model context budget.
 * We refuse rather than silently truncate (CLAUDE.md Section 8 explicit rule).
 */
export class TokenLimitError extends Error {
  constructor(
    public readonly estimatedTokens: number,
    public readonly capTokens: number,
  ) {
    super(
      `Input exceeds token limit: estimated ${estimatedTokens} > cap ${capTokens}. ` +
        `Split this venture or contact engineering.`,
    );
    this.name = "TokenLimitError";
  }
}

/** Thrown after the retry-once corrective attempt also fails to parse/validate. */
export class LLMValidationError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMValidationError";
  }
}

/** Thrown on network errors, non-2xx responses, timeouts, etc. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}
