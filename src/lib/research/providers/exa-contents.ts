import { ResearchProviderError } from "../errors";
import type {
  ContentProvider,
  ContentRequest,
  ContentResponse,
} from "../types";
import {
  canonicalizeResearchUrl,
  sanitizeResearchText,
  validatePublicResearchUrl,
} from "../utils";

const EXA_CONTENTS_URL = "https://api.exa.ai/contents";

interface ExaContentsPayload {
  requestId?: string;
  results?: Array<{
    url?: string;
    title?: string;
    text?: string;
    publishedDate?: string;
  }>;
}

export class ExaContentsProvider implements ContentProvider {
  readonly name = "exa" as const;

  async fetch(request: ContentRequest): Promise<ContentResponse> {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new ResearchProviderError(this.name, "EXA_API_KEY not configured");
    }
    const url = canonicalizeResearchUrl(request.url);
    validatePublicResearchUrl(url);
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(EXA_CONTENTS_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: [url],
          text: { maxCharacters: request.maxCharacters },
          livecrawl: "fallback",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ResearchProviderError(
          this.name,
          `Exa Contents returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
      }
      const payload = (await response.json()) as ExaContentsPayload;
      const hit = payload.results?.[0];
      if (!hit?.text) {
        throw new ResearchProviderError(
          this.name,
          "Exa Contents returned no page text",
          response.status,
        );
      }
      return {
        provider: this.name,
        providerRequestId: payload.requestId ?? null,
        url: canonicalizeResearchUrl(hit.url ?? url),
        title: sanitizeResearchText(hit.title ?? "", 500),
        content: sanitizeResearchText(hit.text, request.maxCharacters),
        publishedAt: hit.publishedDate ?? null,
        contentType: response.headers.get("content-type"),
        latencyMs: Date.now() - started,
        costUsd: 0.001,
      };
    } catch (error) {
      if (error instanceof ResearchProviderError) throw error;
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Exa Contents timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ResearchProviderError(this.name, message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
