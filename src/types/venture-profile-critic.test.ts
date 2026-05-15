import { describe, expect, it } from "vitest";
import {
  CriticFlagSchema,
  Stage1CriticOutputSchema,
} from "./venture-profile";

// A representative critic output that exercises every field shape. Mirrors
// what the critic prompt is instructed to produce in CLAUDE.md §9 / M8.
const SAMPLE_CRITIC_OUTPUT = {
  per_dimension: {
    product_solution: {
      flags: [
        {
          severity: "weak" as const,
          field: "core_features",
          comment:
            "List is generic ('multiple outlets', 'metering'); the source deck mentions specific AI-density readiness which is missing.",
        },
        {
          severity: "over_confident" as const,
          field: "confidence",
          comment:
            "0.9 is too high given that competitor share data is not provided in the source documents.",
        },
      ],
      suggested_edits:
        "Add 'AI-rack-ready high-density power capacity (100-200kW)' to core_features and drop confidence to 0.7.",
    },
    customers: { flags: [] },
    transaction: {
      flags: [
        {
          severity: "missing_context" as const,
          field: "margin_profile",
          comment:
            "Source explicitly flags low-margin trap risk; the profile's notes mention it but margin_profile='medium' may understate downside.",
        },
      ],
    },
    partners: { flags: [] },
    access: { flags: [] },
    geography_regulatory: { flags: [] },
    capital_asset: {
      flags: [
        {
          severity: "unsupported" as const,
          field: "defensibility_model",
          comment:
            "Source documents do not explicitly establish that 'scale + brand' is the dominant defensibility. Suggests this is extracted reasoning, not evidenced.",
        },
      ],
      suggested_edits:
        "Either qualify defensibility_model with a 'speculative' note or move to gaps_in_input.",
    },
  },
  top_level_flags: [
    {
      severity: "weak" as const,
      field: "strategic_risks_and_uncertainties",
      comment:
        "Channel-mismatch risk is real but the implies_search_for could be sharper: name specific incumbents (Vertiv, Eaton) rather than 'established rack PDU vendors'.",
    },
  ],
  overall_notes:
    "Profile is well-supported on the load-bearing fields (substitution_landscape, geography accessibility). Main weakness is confidence calibration — several dimensions are marked 0.8+ without corresponding evidence depth.",
};

describe("Stage1CriticOutputSchema", () => {
  it("parses a representative critic output without errors", () => {
    const result = Stage1CriticOutputSchema.safeParse(SAMPLE_CRITIC_OUTPUT);
    if (!result.success) {
      throw new Error(
        `Schema rejected sample critic output: ${JSON.stringify(
          result.error.format(),
          null,
          2,
        )}`,
      );
    }
    expect(result.data.per_dimension.product_solution.flags.length).toBe(2);
    expect(result.data.top_level_flags.length).toBe(1);
  });

  it("accepts a 'rubber-stamp' output where every dimension has empty flags", () => {
    const empty = {
      per_dimension: Object.fromEntries(
        [
          "product_solution",
          "customers",
          "transaction",
          "partners",
          "access",
          "geography_regulatory",
          "capital_asset",
        ].map((k) => [k, { flags: [] }]),
      ),
      top_level_flags: [],
    };
    expect(() => Stage1CriticOutputSchema.parse(empty)).not.toThrow();
  });

  it("rejects an output missing one of the 7 dimension keys", () => {
    const missing = {
      per_dimension: {
        product_solution: { flags: [] },
        customers: { flags: [] },
        transaction: { flags: [] },
        partners: { flags: [] },
        access: { flags: [] },
        geography_regulatory: { flags: [] },
        // capital_asset missing
      },
      top_level_flags: [],
    };
    expect(() => Stage1CriticOutputSchema.parse(missing)).toThrow();
  });

  it("rejects a flag with an invalid severity", () => {
    const bad = {
      severity: "critical" as unknown as "weak",
      field: "x",
      comment: "y",
    };
    expect(() => CriticFlagSchema.parse(bad)).toThrow();
  });

  it("rejects an empty comment", () => {
    const bad = { severity: "weak" as const, field: "x", comment: "" };
    expect(() => CriticFlagSchema.parse(bad)).toThrow();
  });

  it("enforces the per-dimension flag cap of 8", () => {
    const tooMany = {
      per_dimension: {
        product_solution: {
          flags: Array.from({ length: 9 }, (_, i) => ({
            severity: "weak" as const,
            field: `field_${i}`,
            comment: "redundant",
          })),
        },
        customers: { flags: [] },
        transaction: { flags: [] },
        partners: { flags: [] },
        access: { flags: [] },
        geography_regulatory: { flags: [] },
        capital_asset: { flags: [] },
      },
      top_level_flags: [],
    };
    expect(() => Stage1CriticOutputSchema.parse(tooMany)).toThrow();
  });
});
