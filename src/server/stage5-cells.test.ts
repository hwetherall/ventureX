import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Parameter } from "@/types/parameter";

import {
  assembleTier1Prompt,
  assembleTier2Prompt,
  assembleTier3Prompt,
  mergeCitationSets,
  partitionByTier,
  runTier2PreSearch,
} from "./stage5-cells";

const mockUniversalParam: Parameter = {
  id: "founded_year",
  name: "Founded Year",
  tier: "universal",
  innovera_dimension: "meta",
  value_type: "number",
  cell_budget: "atom",
  citation_required: true,
  source_preference: ["official_company"],
  prompt_hint: "Find the founded year.",
};

const mockFrameworkParam: Parameter = {
  id: "core_offering",
  name: "Core Offering",
  tier: "framework",
  innovera_dimension: "product_solution",
  value_type: "prose",
  cell_budget: "sentence",
  citation_required: true,
  source_preference: ["official_company"],
  prompt_hint: "Summarize the core offering.",
};

const mockDynamicParam: Parameter = {
  id: "latest_product_announcement",
  name: "Latest Product Announcement",
  tier: "dynamic",
  innovera_dimension: "product_solution",
  value_type: "prose",
  cell_budget: "sentence",
  citation_required: true,
  source_preference: ["news", "official_company"],
  prompt_hint: "Find the latest product announcement in rack PDU.",
  source_field: "dimensions.product_solution.substitution_landscape[0]",
};

describe("partitionByTier", () => {
  it("groups parameters by tier with empty arrays for missing tiers", () => {
    const result = partitionByTier([mockUniversalParam, mockUniversalParam]);
    expect(result.universal).toHaveLength(2);
    expect(result.framework).toHaveLength(0);
    expect(result.dynamic).toHaveLength(0);
  });

  it("partitions a mixed schema correctly", () => {
    const result = partitionByTier([
      mockUniversalParam,
      mockFrameworkParam,
      mockDynamicParam,
    ]);
    expect(result.universal).toHaveLength(1);
    expect(result.framework).toHaveLength(1);
    expect(result.dynamic).toHaveLength(1);
  });
});

describe("assembleTier1Prompt", () => {
  const promptBody = [
    "# ROLE",
    "Tier 1 role text",
    "",
    "# INPUT",
    "",
    "[The venture context, candidate, and Tier 1 parameter list will be appended below.]",
  ].join("\n");

  it("strips the input placeholder and appends candidate + parameters", () => {
    const out = assembleTier1Prompt(promptBody, {
      candidateName: "Schneider Electric",
      candidateRationale: "Direct rack-PDU competitor with global footprint.",
      ventureDescription: "[the parent] enters rack-mounted power distribution.",
      parameters: [mockUniversalParam],
    });
    expect(out).not.toContain("[The venture context");
    expect(out).toContain("Schneider Electric");
    expect(out).toContain("Direct rack-PDU competitor");
    expect(out).toContain("founded_year");
  });
});

describe("assembleTier2Prompt", () => {
  const promptBody = [
    "# ROLE",
    "Tier 2 role text",
    "",
    "# INPUT",
    "",
    "[The venture context, candidate with M13 citations, and Tier 2 parameter list will be appended below.]",
  ].join("\n");

  it("inlines M13 citations with [c1], [c2] tags", () => {
    const out = assembleTier2Prompt(promptBody, {
      candidateName: "Schneider Electric",
      candidateRationale: "Direct competitor.",
      ventureDescription: "[the parent] enters rack PDU.",
      parameters: [mockFrameworkParam],
      m13Citations: [
        {
          id: "c1",
          url: "https://www.se.com/about",
          title: "About Schneider Electric",
          query: "rack PDU vendors",
          source: "m13",
        },
        {
          id: "c2",
          url: "https://www.se.com/products/ecostruxure",
          title: "EcoStruxure IT",
          query: "DCIM vendors",
          source: "m13",
        },
      ],
      runTimestamp: "2026-05-19T12:00:00Z",
    });
    expect(out).toContain("[c1]");
    expect(out).toContain("https://www.se.com/about");
    expect(out).toContain("[c2]");
    expect(out).toContain("2026-05-19T12:00:00Z");
    expect(out).toContain("core_offering");
  });

  it("emits a clear note when no M13 citations are available", () => {
    const out = assembleTier2Prompt(promptBody, {
      candidateName: "Some Candidate",
      candidateRationale: "Training-data-only candidate.",
      ventureDescription: "[the parent] enters rack PDU.",
      parameters: [mockFrameworkParam],
      m13Citations: [],
      runTimestamp: "2026-05-19T12:00:00Z",
    });
    expect(out).toContain("No citations available");
  });
});

// ────────────────────────────────────────────────────────────────────────
// M15-F2: Tier 2 pre-search + citation set merging
// ────────────────────────────────────────────────────────────────────────

describe("mergeCitationSets", () => {
  it("returns m13 only when presearch is empty", () => {
    const m13 = [
      { id: "c1", url: "https://a", title: "A", query: "x", source: "m13" as const },
    ];
    expect(mergeCitationSets(m13, [])).toEqual(m13);
  });

  it("appends pre-search citations that don't collide with m13 URLs", () => {
    const m13 = [
      { id: "c1", url: "https://a", title: "A", query: "x", source: "m13" as const },
    ];
    const pre = [
      {
        id: "p1",
        url: "https://b",
        title: "B",
        query: "y",
        source: "t2_presearch" as const,
        snippet: "...",
      },
    ];
    const out = mergeCitationSets(m13, pre);
    expect(out).toHaveLength(2);
    expect(out[1]!.url).toBe("https://b");
  });

  it("drops pre-search citations that collide with m13 URLs (m13 wins)", () => {
    const m13 = [
      { id: "c1", url: "https://a", title: "From M13", query: "x", source: "m13" as const },
    ];
    const pre = [
      {
        id: "p1",
        url: "https://a", // collision
        title: "Also from presearch",
        query: "y",
        source: "t2_presearch" as const,
      },
    ];
    const out = mergeCitationSets(m13, pre);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("From M13");
    expect(out[0]!.source).toBe("m13");
  });
});

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.EXA_API_KEY;

function buildFakeInsforge() {
  const exaCallLogInserts: unknown[] = [];
  const insforge = {
    database: {
      from: (table: string) => ({
        insert: async (rows: unknown[]) => {
          if (table === "exa_call_logs") {
            exaCallLogInserts.push(...rows);
          }
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof runTier2PreSearch>[0]["insforge"];
  return { insforge, exaCallLogInserts };
}

function mockExaResponses(
  builder: (callIndex: number, payload: Record<string, unknown>) => Response,
) {
  let callIndex = 0;
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    payloads.push(body);
    const idx = callIndex++;
    return builder(idx, body);
  }) as typeof fetch;
  return { payloads };
}

function exaJsonResponse(
  results: { url: string; title: string; text: string }[],
): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.EXA_API_KEY = "test_key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.EXA_API_KEY;
  } else {
    process.env.EXA_API_KEY = ORIGINAL_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("runTier2PreSearch", () => {
  it("fires 5 parallel Exa queries with includeText=candidateName", async () => {
    const { insforge } = buildFakeInsforge();
    const { payloads } = mockExaResponses(() =>
      exaJsonResponse([
        { url: "https://example.com/r", title: "R", text: "Schneider Electric…" },
      ]),
    );

    await runTier2PreSearch({
      insforge,
      ventureId: "v1",
      candidateId: "c1",
      candidateName: "Schneider Electric",
    });

    expect(payloads).toHaveLength(5);
    for (const p of payloads) {
      // Exa requires includeText as a single-element array, not a string.
      expect(p).toMatchObject({ includeText: ["Schneider Electric"] });
      expect((p.query as string).startsWith("Schneider Electric ")).toBe(true);
    }
  });

  it("dedupes results by URL across the 5 queries", async () => {
    const { insforge } = buildFakeInsforge();
    // Every Exa call returns the same single URL — should appear once.
    mockExaResponses(() =>
      exaJsonResponse([
        {
          url: "https://www.se.com/annual-report",
          title: "Annual Report",
          text: "Schneider Electric annual report…",
        },
      ]),
    );

    const citations = await runTier2PreSearch({
      insforge,
      ventureId: "v1",
      candidateId: "c1",
      candidateName: "Schneider Electric",
    });

    expect(citations).toHaveLength(1);
    expect(citations[0]!.source).toBe("t2_presearch");
    expect(citations[0]!.url).toBe("https://www.se.com/annual-report");
  });

  it("survives a single query failure via Promise.allSettled (partial coverage)", async () => {
    const { insforge, exaCallLogInserts } = buildFakeInsforge();
    let callIndex = 0;
    mockExaResponses(() => {
      const i = callIndex++;
      // Second query throws; the rest succeed.
      if (i === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return exaJsonResponse([
        {
          url: `https://example.com/r${i}`,
          title: `R${i}`,
          text: "Schneider Electric…",
        },
      ]);
    });

    const citations = await runTier2PreSearch({
      insforge,
      ventureId: "v1",
      candidateId: "c1",
      candidateName: "Schneider Electric",
    });

    // 4 of 5 queries succeeded, 1 result each = 4 citations.
    expect(citations).toHaveLength(4);
    // The error path should still produce an exa_call_logs row (with error set).
    const errorRow = exaCallLogInserts.find(
      (row) => (row as { error: string | null }).error !== null,
    );
    expect(errorRow).toBeDefined();
  });

  it("returns empty array when all 5 queries fail (M13-only fallback path)", async () => {
    const { insforge } = buildFakeInsforge();
    mockExaResponses(() => new Response("error", { status: 500 }));

    const citations = await runTier2PreSearch({
      insforge,
      ventureId: "v1",
      candidateId: "c1",
      candidateName: "Schneider Electric",
    });

    expect(citations).toEqual([]);
  });

  it("writes one exa_call_logs row per query with stage=stage_5_t2_presearch", async () => {
    const { insforge, exaCallLogInserts } = buildFakeInsforge();
    mockExaResponses(() =>
      exaJsonResponse([
        { url: "https://example.com/x", title: "X", text: "Schneider…" },
      ]),
    );

    await runTier2PreSearch({
      insforge,
      ventureId: "v1",
      candidateId: "c1",
      candidateName: "Schneider Electric",
    });

    expect(exaCallLogInserts).toHaveLength(5);
    for (const row of exaCallLogInserts as Record<string, unknown>[]) {
      expect(row.stage).toBe("stage_5_t2_presearch");
      expect(row.parameter_key).toBeNull();
    }
  });
});

describe("assembleTier3Prompt", () => {
  const promptBody = [
    "# ROLE",
    "Tier 3 role text",
    "",
    "# INPUT",
    "",
    "[The candidate name, one Tier 3 parameter, and up to 3 Exa search results will be appended below.]",
  ].join("\n");

  it("inlines candidate, one parameter, and Exa results", () => {
    const out = assembleTier3Prompt(promptBody, {
      candidateName: "Schneider Electric",
      parameter: mockDynamicParam,
      exaResults: [
        {
          url: "https://www.dcd.com/news/schneider-ecostruxure-2025",
          title: "Schneider launches EcoStruxure IT 2025",
          text: "Schneider Electric announced EcoStruxure IT in Q4 2025...",
        },
        {
          url: "https://www.se.com/press/2026-q1",
          title: "Schneider Q1 2026 press",
          text: "Acquisition of Motivair completed in 2026-Q1.",
        },
      ],
      runTimestamp: "2026-05-19T12:00:00Z",
    });
    expect(out).toContain("Schneider Electric");
    expect(out).toContain("latest_product_announcement");
    expect(out).toContain("https://www.dcd.com/news/schneider-ecostruxure-2025");
    expect(out).toContain("Acquisition of Motivair");
  });

  it("handles zero Exa results gracefully", () => {
    const out = assembleTier3Prompt(promptBody, {
      candidateName: "Schneider Electric",
      parameter: mockDynamicParam,
      exaResults: [],
      runTimestamp: "2026-05-19T12:00:00Z",
    });
    expect(out).toContain("(no results)");
  });
});
