import { describe, expect, it } from "vitest";
import { Stage2WeightingOutputSchema } from "./venture-profile";

// Representative output exercising every dimension + the optional
// synthesis_notes field. Weights chosen to sum to 1.00 and to satisfy the
// CLAUDE.md §13 ABB criteria (product_solution / capital_asset /
// geography_regulatory ≥0.15, access ≤0.05).
const SAMPLE_WEIGHTS_OUTPUT = {
  weights: {
    product_solution: {
      weight: 0.25,
      rationale:
        "Rich substitution landscape (busbar, power shelves, DC distribution, in-rack DC, server-mounted) makes mechanism choice the central competitive question — competitors that ship a different mechanism would directly disrupt the JTBD.",
    },
    customers: {
      weight: 0.08,
      rationale:
        "B2B-Enterprise segment is well-defined but not a primary differentiator; most plausible competitors target the same hyperscale + colocation buyer set.",
    },
    transaction: {
      weight: 0.07,
      rationale:
        "Hardware unit-sales model is category-standard. Margin profile is a risk but the business model itself is not where this venture wins.",
    },
    partners: {
      weight: 0.10,
      rationale:
        "Channel mismatch with traditional electrical-equipment distribution is a real risk — server OEMs and integrators are the route to market, not the parent's existing channels.",
    },
    access: {
      weight: 0.03,
      rationale:
        "Access intensity is low — buyers seek specs and pricing through known IT channels rather than being acquired via channel mastery.",
    },
    geography_regulatory: {
      weight: 0.20,
      rationale:
        "China accessibility gap (~$500M TAM, ~$75M reachable) and regional certification requirements (UL/CE) make geography a load-bearing constraint on competitor relevance.",
    },
    capital_asset: {
      weight: 0.27,
      rationale:
        "High capital intensity + hardware asset type + manufacturing footprint requirement put the moat in scale and supply chain. Competitors without comparable industrial capacity are structurally disadvantaged.",
    },
  },
  synthesis_notes:
    "Product, capital, and geography together account for ~72% of the weight — this venture wins or loses on mechanism choice executed at industrial scale within accessible markets. Access weighted low because B2B-E channel mismatch is a risk to manage, not a moat to build.",
};

describe("Stage2WeightingOutputSchema", () => {
  it("parses a representative weighting output without errors", () => {
    const result = Stage2WeightingOutputSchema.safeParse(SAMPLE_WEIGHTS_OUTPUT);
    if (!result.success) {
      throw new Error(
        `Schema rejected sample weighting output: ${JSON.stringify(
          result.error.format(),
          null,
          2,
        )}`,
      );
    }
    expect(result.data.weights.product_solution.weight).toBe(0.25);
    expect(result.data.synthesis_notes?.length).toBeGreaterThan(0);
  });

  it("accepts output without synthesis_notes", () => {
    const { synthesis_notes: _drop, ...withoutNotes } = SAMPLE_WEIGHTS_OUTPUT;
    void _drop;
    expect(() =>
      Stage2WeightingOutputSchema.parse(withoutNotes),
    ).not.toThrow();
  });

  it("rejects output missing one of the 7 dimensions", () => {
    const { weights, ...rest } = SAMPLE_WEIGHTS_OUTPUT;
    const { capital_asset: _drop, ...missingOne } = weights;
    void _drop;
    expect(() =>
      Stage2WeightingOutputSchema.parse({ ...rest, weights: missingOne }),
    ).toThrow();
  });

  it("rejects a weight outside [0, 1]", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    bad.weights.access.weight = 1.2;
    expect(() => Stage2WeightingOutputSchema.parse(bad)).toThrow();
  });

  it("rejects a negative weight", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    bad.weights.customers.weight = -0.05;
    expect(() => Stage2WeightingOutputSchema.parse(bad)).toThrow();
  });

  it("rejects an empty rationale", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    bad.weights.transaction.rationale = "";
    expect(() => Stage2WeightingOutputSchema.parse(bad)).toThrow();
  });

  it("rejects a rationale over 500 chars", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    bad.weights.transaction.rationale = "x".repeat(501);
    expect(() => Stage2WeightingOutputSchema.parse(bad)).toThrow();
  });

  it("rejects synthesis_notes over 600 chars", () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    bad.synthesis_notes = "x".repeat(601);
    expect(() => Stage2WeightingOutputSchema.parse(bad)).toThrow();
  });

  // Sum-to-1 is enforced by the orchestrator (renormalize ∈ [0.95, 1.05],
  // throw outside). Zod sees one dimension at a time so we do NOT enforce
  // the sum here — a sample with weights summing to 0.50 should still parse.
  it("does NOT enforce sum-to-1 at the schema layer (orchestrator does)", () => {
    const halfSum = JSON.parse(JSON.stringify(SAMPLE_WEIGHTS_OUTPUT));
    for (const key of Object.keys(halfSum.weights)) {
      halfSum.weights[key].weight /= 2;
    }
    expect(() => Stage2WeightingOutputSchema.parse(halfSum)).not.toThrow();
  });
});
