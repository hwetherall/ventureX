import { ResearchProviderError } from "../errors";
import type { SearchProvider, SearchRequest, SearchResponse } from "../types";
import { canonicalizeResearchUrl, sanitizeResearchText } from "../utils";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface BravePayload {
  query?: { original?: string };
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      page_age?: string;
    }>;
  };
}

function queryWithDomains(request: SearchRequest): string {
  if (!request.includeDomains?.length) return request.query;
  const domains = request.includeDomains
    .slice(0, 5)
    .map((domain) => `site:${domain}`)
    .join(" OR ");
  return `${request.query} (${domains})`;
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave" as const;

  async search(request: SearchRequest): Promise<SearchResponse> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      throw new ResearchProviderError(
        this.name,
        "BRAVE_SEARCH_API_KEY not configured",
      );
    }
    const query = queryWithDomains(request);
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(Math.max(request.count, 1), 20)),
      country: request.country ?? "us",
      search_lang: request.language ?? "en",
      safesearch: "moderate",
      extra_snippets: "true",
    });
    if (request.dateFrom || request.dateTo) {
      params.set(
        "freshness",
        `${request.dateFrom ?? "1970-01-01"}to${request.dateTo ?? new Date().toISOString().slice(0, 10)}`,
      );
    }
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ResearchProviderError(
          this.name,
          `Brave returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
      }
      const payload = (await response.json()) as BravePayload;
      const hits = (payload.web?.results ?? []).flatMap((hit, index) => {
        if (!hit.url) return [];
        try {
          return [
            {
              provider: this.name,
              url: canonicalizeResearchUrl(hit.url),
              title: sanitizeResearchText(hit.title ?? "", 500),
              snippet: sanitizeResearchText(hit.description ?? "", 5_000),
              publishedAt: hit.page_age ?? hit.age ?? null,
              rank: index + 1,
              score: null,
              searchQuery: query,
            },
          ];
        } catch {
          return [];
        }
      });
      return {
        provider: this.name,
        providerRequestId: response.headers.get("x-request-id"),
        query,
        hits,
        latencyMs: Date.now() - started,
        costUsd: 0.005,
      };
    } catch (error) {
      if (error instanceof ResearchProviderError) throw error;
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Brave timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ResearchProviderError(this.name, message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
