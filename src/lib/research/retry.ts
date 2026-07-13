import { OpenRouterError } from "@/lib/openrouter/errors";

export interface TransientRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export function isTransientOpenRouterError(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false;
  if (error.status === undefined) return true;
  return (
    [408, 409, 425, 429].includes(error.status) ||
    error.status >= 500
  );
}

export async function withTransientOpenRouterRetry<T>(
  operation: () => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 750);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (
        attempt >= maxAttempts ||
        !isTransientOpenRouterError(error)
      ) {
        throw error;
      }
      await delay(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
