import type { ResearchProviderName } from "./types";

export class ResearchProviderError extends Error {
  constructor(
    public readonly provider: ResearchProviderName,
    message: string,
    public readonly status?: number,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "ResearchProviderError";
  }
}

export class ResearchBudgetError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly estimatedNextUsd: number,
    public readonly hardCapUsd: number,
  ) {
    super(
      `Research hard cap exceeded: $${spentUsd.toFixed(4)} spent; ` +
        `$${estimatedNextUsd.toFixed(4)} estimated next; cap $${hardCapUsd.toFixed(2)}.`,
    );
    this.name = "ResearchBudgetError";
  }
}

export class UnsafeResearchUrlError extends Error {
  constructor(public readonly url: string, reason: string) {
    super(`Unsafe research URL rejected: ${reason}`);
    this.name = "UnsafeResearchUrlError";
  }
}
