/**
 * Thrown on Exa API failures: missing key, network error, non-2xx response,
 * timeout, or malformed payload. Mirrors the OpenRouterError shape so the
 * Stage 3 orchestrator's `formatErrorForUser` can switch on it uniformly.
 */
export class ExaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExaError";
  }
}
