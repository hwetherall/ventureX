import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrightDataContentProvider } from "./bright-data";
import { BraveSearchProvider } from "./brave";
import { ExaContentsProvider } from "./exa-contents";
import { GleifProvider } from "./official/gleif";
import { PerplexityDeepResearchProvider } from "./perplexity";

const originalFetch = globalThis.fetch;
const env = {
  brave: process.env.BRAVE_SEARCH_API_KEY,
  exa: process.env.EXA_API_KEY,
  bright: process.env.BRIGHT_DATA_API_KEY,
  zone: process.env.BRIGHT_DATA_ZONE,
  perplexity: process.env.PERPLEXITY_API_KEY,
  perplexityEnabled: process.env.CELL_RESEARCH_PERPLEXITY_ENABLED,
};

beforeEach(() => {
  process.env.BRAVE_SEARCH_API_KEY = "brave-test";
  process.env.EXA_API_KEY = "exa-test";
  process.env.BRIGHT_DATA_API_KEY = "bright-test";
  process.env.BRIGHT_DATA_ZONE = "test-zone";
  process.env.PERPLEXITY_API_KEY = "perplexity-test";
  process.env.CELL_RESEARCH_PERPLEXITY_ENABLED = "true";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restore("BRAVE_SEARCH_API_KEY", env.brave);
  restore("EXA_API_KEY", env.exa);
  restore("BRIGHT_DATA_API_KEY", env.bright);
  restore("BRIGHT_DATA_ZONE", env.zone);
  restore("PERPLEXITY_API_KEY", env.perplexity);
  restore("CELL_RESEARCH_PERPLEXITY_ENABLED", env.perplexityEnabled);
  vi.restoreAllMocks();
});

describe("V2 provider normalization", () => {
  it("normalizes Brave web results", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Vertiv product",
                  url: "https://vertiv.com/product?utm_source=test",
                  description: "Vertiv offers rack power distribution.",
                  page_age: "2026-01-01",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    const response = await new BraveSearchProvider().search({
      query: "Vertiv rack PDU",
      count: 10,
    });
    expect(response.hits).toHaveLength(1);
    expect(response.hits[0]!.url).toBe("https://vertiv.com/product");
    expect(response.hits[0]!.searchQuery).toContain("Vertiv");
  });

  it("normalizes Exa full page contents", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            requestId: "exa-1",
            results: [
              {
                url: "https://vertiv.com/product",
                title: "Product",
                text: "Complete product page text",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    const response = await new ExaContentsProvider().fetch({
      url: "https://vertiv.com/product",
      maxCharacters: 10_000,
    });
    expect(response.content).toContain("Complete product page");
    expect(response.providerRequestId).toBe("exa-1");
  });

  it("accepts Bright Data raw markdown responses", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("# Product\nTap-off unit details", { status: 200 }),
    ) as typeof fetch;
    const response = await new BrightDataContentProvider().fetch({
      url: "https://example.com/product",
      maxCharacters: 10_000,
    });
    expect(response.content).toContain("Tap-off unit");
  });

  it("normalizes a GLEIF legal name record", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "LEI123",
                attributes: {
                  lei: "LEI123",
                  entity: {
                    legalName: { name: "Vertiv Holdings Co" },
                    legalAddress: { country: "US" },
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    const facts = await new GleifProvider().lookup({
      candidate: {
        candidateId: "c",
        name: "Vertiv Holdings",
        aliases: ["Vertiv"],
        domains: ["vertiv.com"],
      },
      parameterKey: "legal_name",
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(facts[0]!.value).toBe("Vertiv Holdings Co");
    expect(facts[0]!.sourceClass).toBe("official_registry");
  });

  it("uses Perplexity only as costed source discovery", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "pplx-1",
          choices: [
            { message: { content: "A research synthesis with citations." } },
          ],
          citations: [
            "https://www.vertiv.com/en-us/about/news-and-insights/articles/press-releases/example?utm_source=pplx",
          ],
          search_results: [
            {
              title: "Vertiv annual report",
              url: "https://www.vertiv.com/en-us/about/news-and-insights/articles/press-releases/example",
              date: "2026-02-12",
              snippet: "Vertiv reported 31,000 employees at year end.",
            },
          ],
          usage: { cost: { total_cost: 0.4123 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const response = await new PerplexityDeepResearchProvider().research({
      candidate: {
        candidateId: "vertiv",
        name: "Vertiv Holdings",
        legalName: "Vertiv Holdings Co",
        aliases: ["Vertiv Holdings", "Vertiv"],
        domains: ["vertiv.com"],
      },
      parameter: {
        id: "headcount",
        name: "Headcount",
        tier: "universal",
        innovera_dimension: "meta",
        value_type: "object",
        cell_budget: "sentence",
        citation_required: true,
        source_preference: ["official_company"],
        prompt_hint: "Return a count and date.",
      },
      proofRule: "Employee count and explicit as-of date are required.",
      priorReason: "First pass found only field-service headcount.",
      asOf: "2026-07-13T00:00:00.000Z",
      maxCostUsd: 1.25,
    });
    expect(response.value).toBeNull();
    expect(response.confidence).toBe("unknown");
    expect(response.costUsd).toBe(0.4123);
    expect(response.evidence).toHaveLength(1);
    expect(response.evidence[0]!.sourceClass).toBe("official_company");
    expect(response.evidence[0]!.canonicalUrl).not.toContain("utm_source");
    expect(requestBody).toMatchObject({ model: "sonar-deep-research" });
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
