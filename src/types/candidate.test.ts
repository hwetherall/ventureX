import { describe, expect, it } from "vitest";
import {
  CandidateCompanySchema,
  CitationSchema,
  Stage3CandidatesOutputSchema,
} from "./candidate";

// Representative Stage 3 output for the ABB Rack PDU venture. Hits all three
// candidate types and exercises a range of `dimensions_implicated` cardinality
// (1, 2, 3, 7). Used as the round-trip fixture for the candidate schema.
//
// This is NOT the §13-equivalent expected_candidates.json — that's TODO #7
// content. This fixture is purely schema-shape coverage.
const SAMPLE_CANDIDATES_OUTPUT = {
  candidates: [
    {
      name: "Schneider Electric",
      type: "direct" as const,
      rationale:
        "Industry-leading rack PDU vendor with the APC product line. Same JTBD (high-density rack power distribution) and same mechanism (rack-mounted PDU) as VentureX. Manufacturing scale and global service footprint make them the incumbent to displace.",
      dimensions_implicated: [
        "product_solution",
        "capital_asset",
        "geography_regulatory",
      ],
    },
    {
      name: "Eaton",
      type: "direct" as const,
      rationale:
        "Diversified electrical-equipment manufacturer with a strong rack PDU product line and deep data-center channel relationships. Mirrors VentureX's industrial-scale + IT-distribution channel ambition.",
      dimensions_implicated: ["product_solution", "partners", "capital_asset"],
    },
    {
      name: "Vertiv",
      type: "direct" as const,
      rationale:
        "Pure-play data-center infrastructure vendor (former Emerson Network Power). Direct competitor on rack PDUs with hyperscale and colocation customer overlap.",
      dimensions_implicated: ["product_solution", "customers"],
    },
    {
      name: "Server Technology (Legrand)",
      type: "direct" as const,
      rationale:
        "Specialist rack PDU brand under Legrand. Strong in intelligent / metered PDU segment. Same buyer (data center operator), same mechanism.",
      dimensions_implicated: ["product_solution"],
    },
    {
      name: "Raritan (Legrand)",
      type: "direct" as const,
      rationale:
        "Intelligent PDU vendor with environmental monitoring tie-ins. Direct competitor on the same product category and buyer set.",
      dimensions_implicated: ["product_solution", "customers"],
    },
    {
      name: "Anord Mardix (Flex)",
      type: "category" as const,
      rationale:
        "Hyperscale switchgear and busway vendor. Different JTBD (facility-level power distribution) but same mechanism family — wins business by selling integrated power solutions that obviate rack-level PDU buying decisions.",
      dimensions_implicated: ["product_solution", "partners"],
    },
    {
      name: "Starline (Legrand)",
      type: "same_problem_different_mechanism" as const,
      rationale:
        "Overhead busway / tap-off systems are the leading SPDM threat: data centers using a Starline overhead busway can tap power directly into racks without rack-mounted PDUs at all. Mentioned explicitly in the substitution landscape.",
      dimensions_implicated: ["product_solution"],
    },
    {
      name: "Open Compute Project power-shelf vendors",
      type: "same_problem_different_mechanism" as const,
      rationale:
        "OCP-style power shelves consolidate AC-to-DC conversion at the rack and distribute DC to servers — completely different mechanism that eliminates traditional rack PDUs. Critical SPDM for AC-to-DC migration risk.",
      dimensions_implicated: ["product_solution", "capital_asset"],
    },
    {
      name: "Delta Electronics",
      type: "direct" as const,
      rationale:
        "Taiwan-based power-electronics manufacturer with growing rack PDU and DC power product lines. Strong in Asian markets where VentureX's parent has accessibility constraints.",
      dimensions_implicated: ["product_solution", "geography_regulatory"],
    },
    {
      name: "CyberPower",
      type: "direct" as const,
      rationale:
        "Mid-market rack PDU vendor with strong colocation channel. Same mechanism, slightly different customer tier (SMB-leaning).",
      dimensions_implicated: ["product_solution", "customers"],
    },
  ],
  generation_notes:
    "Candidates skew toward US/EU/Taiwan vendors due to training-data bias. Expect M13 web search to surface Chinese and Indian PDU vendors invisible to LLM-only brainstorm.",
};

describe("Stage3CandidatesOutputSchema", () => {
  it("parses a representative Stage 3 output without errors", () => {
    const result = Stage3CandidatesOutputSchema.safeParse(SAMPLE_CANDIDATES_OUTPUT);
    if (!result.success) {
      throw new Error(
        `Schema rejected sample candidates output: ${JSON.stringify(
          result.error.format(),
          null,
          2,
        )}`,
      );
    }
    expect(result.data.candidates).toHaveLength(10);
    expect(result.data.generation_notes?.length).toBeGreaterThan(0);
  });

  it("accepts output without generation_notes", () => {
    const { generation_notes: _drop, ...withoutNotes } = SAMPLE_CANDIDATES_OUTPUT;
    void _drop;
    expect(() =>
      Stage3CandidatesOutputSchema.parse(withoutNotes),
    ).not.toThrow();
  });

  it("rejects fewer than 10 candidates", () => {
    const tooFew = {
      ...SAMPLE_CANDIDATES_OUTPUT,
      candidates: SAMPLE_CANDIDATES_OUTPUT.candidates.slice(0, 9),
    };
    expect(() => Stage3CandidatesOutputSchema.parse(tooFew)).toThrow();
  });

  it("rejects more than 60 candidates", () => {
    const dupe = SAMPLE_CANDIDATES_OUTPUT.candidates[0];
    const tooMany = {
      ...SAMPLE_CANDIDATES_OUTPUT,
      candidates: Array.from({ length: 61 }, () => ({ ...dupe })),
    };
    expect(() => Stage3CandidatesOutputSchema.parse(tooMany)).toThrow();
  });

  it("rejects an invalid candidate type", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.candidates[0].type = "adjacent";
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });

  it("rejects an unknown dimension key in dimensions_implicated", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.candidates[0].dimensions_implicated = ["product_solution", "made_up"];
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });

  it("rejects an empty dimensions_implicated array", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.candidates[0].dimensions_implicated = [];
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });

  it("rejects an empty name", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.candidates[0].name = "";
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });

  it("rejects a rationale over 800 chars", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.candidates[0].rationale = "x".repeat(801);
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });

  it("rejects generation_notes over 800 chars", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_CANDIDATES_OUTPUT));
    bad.generation_notes = "x".repeat(801);
    expect(() => Stage3CandidatesOutputSchema.parse(bad)).toThrow();
  });
});

describe("CandidateCompanySchema", () => {
  it("accepts all three candidate types", () => {
    const base = SAMPLE_CANDIDATES_OUTPUT.candidates[0];
    for (const type of [
      "direct",
      "category",
      "same_problem_different_mechanism",
    ] as const) {
      expect(() => CandidateCompanySchema.parse({ ...base, type })).not.toThrow();
    }
  });

  it("accepts dimensions_implicated of length 7 (all dimensions)", () => {
    const base = SAMPLE_CANDIDATES_OUTPUT.candidates[0];
    expect(() =>
      CandidateCompanySchema.parse({
        ...base,
        dimensions_implicated: [
          "product_solution",
          "customers",
          "transaction",
          "partners",
          "access",
          "geography_regulatory",
          "capital_asset",
        ],
      }),
    ).not.toThrow();
  });
});

describe("CitationSchema (M13)", () => {
  const sampleCitation = {
    url: "https://www.servertech.com/products/pro3x-rack-pdus",
    title: "PRO3X Switched POPS Rack PDUs | Server Technology",
    query:
      "Companies providing busbar+tap-off systems, power shelves, in-rack high-density power distribution",
  };

  it("parses a representative citation", () => {
    expect(() => CitationSchema.parse(sampleCitation)).not.toThrow();
  });

  it("rejects a non-URL string in url", () => {
    expect(() =>
      CitationSchema.parse({ ...sampleCitation, url: "not-a-url" }),
    ).toThrow();
  });

  it("rejects an empty title", () => {
    expect(() =>
      CitationSchema.parse({ ...sampleCitation, title: "" }),
    ).toThrow();
  });

  it("rejects a title over 300 chars", () => {
    expect(() =>
      CitationSchema.parse({ ...sampleCitation, title: "x".repeat(301) }),
    ).toThrow();
  });

  it("rejects an empty query", () => {
    expect(() =>
      CitationSchema.parse({ ...sampleCitation, query: "" }),
    ).toThrow();
  });

  it("rejects a query over 500 chars", () => {
    expect(() =>
      CitationSchema.parse({ ...sampleCitation, query: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("CandidateCompanySchema with citations (M13)", () => {
  const baseCandidate = SAMPLE_CANDIDATES_OUTPUT.candidates[0];
  const sampleCitation = {
    url: "https://www.servertech.com/products/pro3x-rack-pdus",
    title: "PRO3X Switched POPS Rack PDUs",
    query: "Companies providing busbar+tap-off systems, power shelves",
  };

  it("accepts a candidate without citations (training-data-only path)", () => {
    expect(() => CandidateCompanySchema.parse(baseCandidate)).not.toThrow();
  });

  it("accepts a candidate with 0 citations (explicit empty array)", () => {
    expect(() =>
      CandidateCompanySchema.parse({ ...baseCandidate, citations: [] }),
    ).not.toThrow();
  });

  it("accepts a candidate with 1-3 citations", () => {
    for (const count of [1, 2, 3]) {
      const citations = Array.from({ length: count }, () => ({
        ...sampleCitation,
      }));
      expect(() =>
        CandidateCompanySchema.parse({ ...baseCandidate, citations }),
      ).not.toThrow();
    }
  });

  it("rejects a candidate with 4+ citations (cap is 3)", () => {
    const citations = Array.from({ length: 4 }, () => ({ ...sampleCitation }));
    expect(() =>
      CandidateCompanySchema.parse({ ...baseCandidate, citations }),
    ).toThrow();
  });

  it("rejects a candidate whose citation has a bad URL", () => {
    expect(() =>
      CandidateCompanySchema.parse({
        ...baseCandidate,
        citations: [{ ...sampleCitation, url: "ftp://invalid" }],
      }),
    ).not.toThrow(); // ftp is still a valid URL scheme
    expect(() =>
      CandidateCompanySchema.parse({
        ...baseCandidate,
        citations: [{ ...sampleCitation, url: "definitely not a url" }],
      }),
    ).toThrow();
  });
});
