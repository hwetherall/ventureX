import { describe, expect, it } from "vitest";

import {
  HARDCODED_PARAMETERS,
  UNIVERSAL_PARAMETERS,
  FRAMEWORK_PARAMETERS,
} from "@/lib/parameters/catalog";
import type { Parameter } from "@/types/parameter";

import {
  formatCostRange,
  formatLatencyRange,
  predictStage5Cost,
} from "./predict";

const SAMPLE_DYNAMIC_PARAMETERS: Parameter[] = Array.from({ length: 15 }).map(
  (_, idx) => ({
    id: `dynamic_param_${idx}`,
    name: `Dynamic Parameter ${idx}`,
    tier: "dynamic" as const,
    innovera_dimension: "product_solution" as const,
    value_type: "prose" as const,
    cell_budget: "sentence" as const,
    citation_required: true,
    source_preference: ["news", "official_company"] as const,
    prompt_hint: `Find the latest signal on dimension ${idx}.`,
    source_field: "dimensions.product_solution.substitution_landscape",
  }),
);

const FULL_SCHEMA: Parameter[] = [...HARDCODED_PARAMETERS, ...SAMPLE_DYNAMIC_PARAMETERS];

describe("predictStage5Cost", () => {
  it("rejects candidateCount < 1", () => {
    expect(() =>
      predictStage5Cost({ parameters: FULL_SCHEMA, candidateCount: 0 }),
    ).toThrow(/candidateCount must be ≥ 1/);
  });

  it("rejects empty parameter schema", () => {
    expect(() =>
      predictStage5Cost({ parameters: [], candidateCount: 1 }),
    ).toThrow(/parameters array is empty/);
  });

  it("counts cells = (T1 + T2 + T3) × candidateCount", () => {
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    expect(result.totalCells).toBe(15 + 21 + 15);
    expect(result.candidateCount).toBe(1);
  });

  it("scales totalCells linearly with candidate count", () => {
    const single = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    const five = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 5,
    });
    expect(five.totalCells).toBe(single.totalCells * 5);
  });

  it("Schneider single-candidate run lands in the $0.50–$2.50 envelope", () => {
    // V1 scope: Schneider Electric only. M15_DESIGN.md / sprint plan project
    // ~$1 per candidate. Wider tolerance here so model-pricing tweaks don't
    // make the test brittle — the point is "scream if it's ten dollars".
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    expect(result.costUsd.min).toBeGreaterThan(0.5);
    expect(result.costUsd.max).toBeLessThan(2.5);
  });

  it("5-candidate run lands well below the $100 cap", () => {
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 5,
    });
    expect(result.costUsd.max).toBeLessThan(15);
    expect(result.exceedsBudgetCap).toBe(false);
  });

  it("flags exceedsBudgetCap when the upper bound exceeds the cap", () => {
    // Force the warning by tightening the cap below the estimate range.
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
      perVentureBudgetCapUsd: 0.5,
    });
    expect(result.exceedsBudgetCap).toBe(true);
  });

  it("flags approachingBudgetCap when upper bound is within 20% of cap", () => {
    const single = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    // Set cap slightly above the upper bound so we sit in the [80%, 100%] window.
    const cap = single.costUsd.max * 1.1;
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
      perVentureBudgetCapUsd: cap,
    });
    expect(result.approachingBudgetCap).toBe(true);
    expect(result.exceedsBudgetCap).toBe(false);
  });

  it("breakdown attributes the right cell counts per tier", () => {
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    const t1 = result.breakdown.find((b) => b.tier === "universal")!;
    const t2 = result.breakdown.find((b) => b.tier === "framework")!;
    const t3 = result.breakdown.find((b) => b.tier === "dynamic")!;

    expect(t1.cells).toBe(15);
    expect(t2.cells).toBe(21);
    expect(t3.cells).toBe(15);
    // T1 + T2 are batched (one call per candidate); T3 is per-cell.
    expect(t1.llmCalls).toBe(1);
    expect(t2.llmCalls).toBe(1);
    expect(t3.llmCalls).toBe(15);
    // T1 doesn't hit Exa; T2 hits 5 pre-search queries (M15-F2); T3 hits
    // per-cell.
    expect(t1.exaSearches).toBe(0);
    expect(t2.exaSearches).toBe(5);
    expect(t3.exaSearches).toBeGreaterThanOrEqual(15);
  });

  it("totals roll up from breakdown", () => {
    const result = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    const summedLlm = result.breakdown.reduce((acc, b) => acc + b.llmCalls, 0);
    const summedExa = result.breakdown.reduce(
      (acc, b) => acc + b.exaSearches,
      0,
    );
    expect(result.totalLlmCalls).toBe(summedLlm);
    expect(result.totalExaSearches).toBe(summedExa);
  });

  it("handles schema with only universal parameters (no T2/T3 cost)", () => {
    const result = predictStage5Cost({
      parameters: [...UNIVERSAL_PARAMETERS],
      candidateCount: 1,
    });
    const t2 = result.breakdown.find((b) => b.tier === "framework")!;
    const t3 = result.breakdown.find((b) => b.tier === "dynamic")!;
    expect(t2.cells).toBe(0);
    expect(t2.llmCalls).toBe(0);
    expect(t2.costUsd.max).toBe(0);
    expect(t3.cells).toBe(0);
    expect(t3.costUsd.max).toBe(0);
  });

  it("handles schema with only framework parameters", () => {
    const result = predictStage5Cost({
      parameters: [...FRAMEWORK_PARAMETERS],
      candidateCount: 1,
    });
    const t1 = result.breakdown.find((b) => b.tier === "universal")!;
    expect(t1.cells).toBe(0);
    expect(t1.llmCalls).toBe(0);
  });

  it("latency scales with candidate count (sequential V1)", () => {
    const one = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    const three = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 3,
    });
    expect(three.latencyMs.min).toBe(one.latencyMs.min * 3);
    expect(three.latencyMs.max).toBe(one.latencyMs.max * 3);
  });

  it("respects model override (cheaper model lowers cost)", () => {
    const opus = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
    });
    const haiku = predictStage5Cost({
      parameters: FULL_SCHEMA,
      candidateCount: 1,
      models: {
        universal: "anthropic/claude-haiku-4.5",
        framework: "anthropic/claude-haiku-4.5",
      },
    });
    expect(haiku.costUsd.max).toBeLessThan(opus.costUsd.max);
  });
});

describe("formatCostRange", () => {
  it("formats USD with two decimals", () => {
    expect(formatCostRange({ min: 0.351, max: 1.2 })).toBe("$0.35 – $1.20");
  });
});

describe("formatLatencyRange", () => {
  it("renders minute ranges", () => {
    expect(formatLatencyRange({ min: 300_000, max: 600_000 })).toBe("~5–10 min");
  });

  it("collapses identical bounds to single value", () => {
    expect(formatLatencyRange({ min: 300_000, max: 300_000 })).toBe("~5 min");
  });
});
