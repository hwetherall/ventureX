import { describe, expect, it, vi } from "vitest";

import { OpenRouterError } from "@/lib/openrouter/errors";

import {
  isTransientOpenRouterError,
  withTransientOpenRouterRetry,
} from "./retry";

describe("V2 OpenRouter retries", () => {
  it("retries a transport failure once", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new OpenRouterError("fetch failed"))
      .mockResolvedValueOnce("ok");

    await expect(
      withTransientOpenRouterRetry(operation, { baseDelayMs: 0 }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent HTTP failures", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new OpenRouterError("insufficient credits", 402));

    await expect(
      withTransientOpenRouterRetry(operation, { baseDelayMs: 0 }),
    ).rejects.toThrow("insufficient credits");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("classifies rate limits and server failures as transient", () => {
    expect(isTransientOpenRouterError(new OpenRouterError("rate", 429))).toBe(
      true,
    );
    expect(isTransientOpenRouterError(new OpenRouterError("server", 503))).toBe(
      true,
    );
    expect(isTransientOpenRouterError(new OpenRouterError("bad", 400))).toBe(
      false,
    );
  });
});
