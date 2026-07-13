import { exaSearch } from "@/lib/exa/search";

import type { SearchProvider, SearchRequest, SearchResponse } from "../types";
import { canonicalizeResearchUrl, sanitizeResearchText } from "../utils";

export class ExaSearchProvider implements SearchProvider {
  readonly name = "exa" as const;

  async search(request: SearchRequest): Promise<SearchResponse> {
    const result = await exaSearch({
      query: request.query,
      numResults: Math.min(Math.max(request.count, 1), 25),
      type: "auto",
      timeoutMs: request.timeoutMs,
      maxCharactersPerResult: 2_500,
      startPublishedDate: request.dateFrom,
      endPublishedDate: request.dateTo,
      includeDomains: request.includeDomains,
      excludeDomains: request.excludeDomains,
    });

    return {
      provider: this.name,
      query: request.query,
      hits: result.results.flatMap((hit, index) => {
        try {
          return [
            {
              provider: this.name,
              url: canonicalizeResearchUrl(hit.url),
              title: sanitizeResearchText(hit.title, 500),
              snippet: sanitizeResearchText(hit.text, 5_000),
              publishedAt: hit.publishedDate ?? null,
              rank: index + 1,
              score: hit.score ?? null,
              searchQuery: request.query,
            },
          ];
        } catch {
          return [];
        }
      }),
      latencyMs: result.latencyMs,
      costUsd: 0.007,
    };
  }
}
