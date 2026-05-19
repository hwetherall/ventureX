import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DynamicParameterSchema,
  ParameterSchema,
  Stage4ParameterBuilderOutputSchema,
} from "./parameter";

const sampleDynamicParameter = {
  id: "busbar_offering",
  name: "Busbar / Tap-off Offering",
  tier: "dynamic" as const,
  innovera_dimension: "product_solution" as const,
  value_type: "object" as const,
  value_schema: {
    status: "enum [shipping, announced, none]",
    product_name: "string | null",
    notes: "string",
  },
  cell_budget: "sentence" as const,
  citation_required: true as const,
  source_preference: ["official_company", "industry_analyst"] as const,
  prompt_hint:
    "Look for product pages mentioning busway, busbar, or tap-off systems used for rack-level power delivery.",
  source_field: "dimensions.product_solution.substitution_landscape[0]",
};

describe("ParameterSchema", () => {
  it("parses a representative dynamic parameter", () => {
    expect(() => ParameterSchema.parse(sampleDynamicParameter)).not.toThrow();
    expect(() =>
      DynamicParameterSchema.parse(sampleDynamicParameter),
    ).not.toThrow();
  });

  it("rejects dynamic parameters without source_field", () => {
    const { source_field: _drop, ...bad } = sampleDynamicParameter;
    void _drop;
    expect(() => DynamicParameterSchema.parse(bad)).toThrow();
  });

  it("rejects dynamic parameters with meta dimension", () => {
    expect(() =>
      DynamicParameterSchema.parse({
        ...sampleDynamicParameter,
        innovera_dimension: "meta",
      }),
    ).toThrow();
  });

  it("rejects unstable ids", () => {
    expect(() =>
      ParameterSchema.parse({ ...sampleDynamicParameter, id: "Bad Id" }),
    ).toThrow();
  });
});

describe("Stage4ParameterBuilderOutputSchema", () => {
  const fixturePath = resolve(
    "test-cases/abb-rack-pdu/expected_profile.json",
  );

  it("parses a valid 10-parameter output shape", () => {
    const profile = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const output = {
      venture_id: profile.venture_codename,
      generated_at: new Date("2026-05-19T12:00:00.000Z").toISOString(),
      dynamic_parameters: Array.from({ length: 10 }, (_, i) => ({
        ...sampleDynamicParameter,
        id: `dynamic_param_${i}`,
      })),
      generation_notes: "Generated for schema-shape coverage.",
    };

    expect(() => Stage4ParameterBuilderOutputSchema.parse(output)).not.toThrow();
  });

  it("rejects fewer than 10 dynamic parameters", () => {
    const output = {
      venture_id: "VentureX",
      generated_at: "2026-05-19T12:00:00.000Z",
      dynamic_parameters: Array.from({ length: 9 }, (_, i) => ({
        ...sampleDynamicParameter,
        id: `dynamic_param_${i}`,
      })),
    };

    expect(() => Stage4ParameterBuilderOutputSchema.parse(output)).toThrow();
  });

  it("rejects generation notes over 800 chars", () => {
    const output = {
      venture_id: "VentureX",
      generated_at: "2026-05-19T12:00:00.000Z",
      dynamic_parameters: Array.from({ length: 10 }, (_, i) => ({
        ...sampleDynamicParameter,
        id: `dynamic_param_${i}`,
      })),
      generation_notes: "x".repeat(801),
    };

    expect(() => Stage4ParameterBuilderOutputSchema.parse(output)).toThrow();
  });
});
