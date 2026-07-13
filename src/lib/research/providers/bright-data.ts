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

const BRIGHT_DATA_URL = "https://api.brightdata.com/request";

interface BrightDataPayload {
  status_code?: number;
  headers?: Record<string, string>;
  body?: string;
}

export class BrightDataContentProvider implements ContentProvider {
  readonly name = "bright_data" as const;

  async fetch(request: ContentRequest): Promise<ContentResponse> {
    const apiKey = process.env.BRIGHT_DATA_API_KEY;
    const zone = process.env.BRIGHT_DATA_ZONE;
    if (!apiKey || !zone) {
      throw new ResearchProviderError(
        this.name,
        "BRIGHT_DATA_API_KEY or BRIGHT_DATA_ZONE not configured",
      );
    }
    const url = canonicalizeResearchUrl(request.url);
    validatePublicResearchUrl(url);
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 45_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(BRIGHT_DATA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zone,
          url,
          format: "raw",
          data_format: "markdown",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ResearchProviderError(
          this.name,
          `Bright Data returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
      }
      const raw = await response.text();
      let body = raw;
      let contentType = response.headers.get("content-type");
      try {
        const payload = JSON.parse(raw) as BrightDataPayload;
        if (payload.status_code && payload.status_code >= 400) {
          throw new ResearchProviderError(
            this.name,
            `Bright Data upstream returned ${payload.status_code}`,
            payload.status_code,
          );
        }
        body = payload.body ?? raw;
        contentType = payload.headers?.["content-type"] ?? contentType;
      } catch (error) {
        if (error instanceof ResearchProviderError) throw error;
        // Raw markdown/HTML is a documented success response shape.
      }
      if (!body.trim()) {
        throw new ResearchProviderError(
          this.name,
          "Bright Data returned an empty page",
        );
      }
      return {
        provider: this.name,
        providerRequestId: response.headers.get("x-request-id"),
        url,
        title: "",
        content: sanitizeResearchText(body, request.maxCharacters),
        contentType,
        latencyMs: Date.now() - started,
        costUsd: 0.0015,
      };
    } catch (error) {
      if (error instanceof ResearchProviderError) throw error;
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Bright Data timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ResearchProviderError(this.name, message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
