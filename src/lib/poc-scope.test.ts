import { describe, expect, it } from "vitest";

import {
  POC_CANDIDATE_COUNT,
  POC_CANDIDATE_SCOPE,
  POC_PARAMETER_COUNT,
  POC_STAGE3_ESTIMATED_OUTPUT_TOKENS,
  POC_STAGE3_MAX_OUTPUT_TOKENS,
  POC_STAGE3_MAX_SEARCH_QUERIES,
  POC_STAGE3_RESULTS_PER_QUERY,
  selectPocResearchParameters,
} from "@/lib/poc-scope";

describe("PoC credit-control scope", () => {
  it("locks candidate generation to three companies and all three categories", () => {
    expect(POC_CANDIDATE_COUNT).toBe(3);
    expect(POC_CANDIDATE_SCOPE).toContain("exactly 3 candidates");
    expect(POC_CANDIDATE_SCOPE).toContain("exactly one Direct");
    expect(POC_CANDIDATE_SCOPE).toContain("exactly one Category");
    expect(POC_CANDIDATE_SCOPE).toContain(
      "exactly one Same-Problem-Different-Mechanism",
    );
  });

  it("keeps search breadth and output reservation inside the PoC budget", () => {
    expect(POC_STAGE3_MAX_SEARCH_QUERIES).toBe(3);
    expect(POC_STAGE3_RESULTS_PER_QUERY).toBe(3);
    expect(POC_STAGE3_ESTIMATED_OUTPUT_TOKENS).toBeLessThanOrEqual(1_000);
    expect(POC_STAGE3_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(1_500);
  });

  it("selects a mixed-difficulty 3/4/3 parameter subset", () => {
    const parameters = [
      ...Array.from({ length: 6 }, (_, id) => ({
        tier: "universal" as const,
        id,
      })),
      ...Array.from({ length: 8 }, (_, id) => ({
        tier: "framework" as const,
        id,
      })),
      ...Array.from({ length: 6 }, (_, id) => ({
        tier: "dynamic" as const,
        id,
      })),
    ];

    const selected = selectPocResearchParameters(parameters);

    expect(selected).toHaveLength(POC_PARAMETER_COUNT);
    expect(
      selected.filter((parameter) => parameter.tier === "universal"),
    ).toHaveLength(3);
    expect(
      selected.filter((parameter) => parameter.tier === "framework"),
    ).toHaveLength(4);
    expect(
      selected.filter((parameter) => parameter.tier === "dynamic"),
    ).toHaveLength(3);
    expect(
      selected.map((parameter) => `${parameter.tier}:${parameter.id}`),
    ).toEqual([
      "universal:0",
      "universal:3",
      "universal:5",
      "framework:0",
      "framework:2",
      "framework:5",
      "framework:7",
      "dynamic:0",
      "dynamic:3",
      "dynamic:5",
    ]);
  });
});
