import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DynamicParameter, Stage4ParameterBuilderOutput } from "@/types/parameter";
import { VentureProfileSchema, type VentureProfile } from "@/types/venture-profile";
import {
  ParameterValidationError,
  validateParameterBuilderOutput,
} from "./validation";

function loadProfile(): VentureProfile {
  const raw = JSON.parse(
    readFileSync(
      resolve("test-cases/abb-rack-pdu/expected_profile.json"),
      "utf-8",
    ),
  );
  return VentureProfileSchema.parse(raw);
}

function param(
  id: string,
  sourceField: string,
  overrides: Partial<DynamicParameter> = {},
): DynamicParameter {
  return {
    id,
    name: id
      .split("_")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" "),
    tier: "dynamic",
    innovera_dimension: "product_solution",
    value_type: "object",
    value_schema: { notes: "string" },
    cell_budget: "sentence",
    citation_required: true,
    source_preference: ["official_company", "official_third_party"],
    prompt_hint: "Find public factual evidence for this brief-specific parameter.",
    source_field: sourceField,
    ...overrides,
  };
}

function validOutput(profile = loadProfile()): Stage4ParameterBuilderOutput {
  const dynamicParameters: DynamicParameter[] = [
    param(
      "busbar_offering",
      "dimensions.product_solution.substitution_landscape[0]",
    ),
    param(
      "power_shelf_offering",
      "dimensions.product_solution.substitution_landscape[1]",
    ),
    param(
      "dc_distribution_offering",
      "dimensions.product_solution.substitution_landscape[2]",
    ),
    param(
      "server_mounted_power_offering",
      "dimensions.product_solution.substitution_landscape[3]",
    ),
    param(
      "rpp_direct_cabling_offering",
      "dimensions.product_solution.substitution_landscape[4]",
    ),
    param(
      "high_density_rack_support_kw",
      "strategic_risks_and_uncertainties[0].risk",
    ),
    param(
      "dc_architecture_product_status",
      "strategic_risks_and_uncertainties[1].risk",
    ),
    param(
      "it_channel_reach",
      "strategic_risks_and_uncertainties[2].risk",
      { innovera_dimension: "access" },
    ),
    param(
      "dcim_software_attach",
      "strategic_risks_and_uncertainties[3].risk",
    ),
    param(
      "pdu_adjacent_ma_history",
      "strategic_risks_and_uncertainties[4].risk",
      { innovera_dimension: "capital_asset", cell_budget: "paragraph" },
    ),
    param(
      "china_market_access",
      "strategic_risks_and_uncertainties[5].risk",
      { innovera_dimension: "geography_regulatory" },
    ),
    param(
      "named_hyperscale_customers",
      "intended_end_state.minimum_success_criteria",
      { innovera_dimension: "customers", value_type: "list" },
    ),
  ];

  return {
    venture_id: profile.venture_codename,
    generated_at: "2026-05-19T12:00:00.000Z",
    dynamic_parameters: dynamicParameters,
  };
}

describe("validateParameterBuilderOutput", () => {
  it("accepts a representative ABB parameter set with required ids", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    const validated = validateParameterBuilderOutput(output, profile);
    const ids = new Set(validated.map((p) => p.id));

    expect(validated.length).toBeGreaterThanOrEqual(12);
    for (const required of [
      "china_market_access",
      "high_density_rack_support_kw",
      "dcim_software_attach",
      "busbar_offering",
      "power_shelf_offering",
      "dc_distribution_offering",
      "server_mounted_power_offering",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("rejects source fields that do not resolve", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters[0] = param("bad_source", "dimensions.nope[0]");

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });

  it("rejects duplicate hardcoded ids", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters[0] = param(
      "core_offering",
      "dimensions.product_solution.substitution_landscape[0]",
    );

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });

  it("rejects dynamic meta dimensions", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters[0] = param(
      "meta_bad",
      "dimensions.product_solution.substitution_landscape[0]",
      { innovera_dimension: "meta" as DynamicParameter["innovera_dimension"] },
    );

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });

  it("rejects missing substitution coverage", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters = output.dynamic_parameters.filter(
      (p) =>
        p.source_field !== "dimensions.product_solution.substitution_landscape[4]",
    );

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });

  it("rejects duplicate substitution coverage", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters[5] = param(
      "duplicate_busbar",
      "dimensions.product_solution.substitution_landscape[0]",
    );

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });

  it("rejects analysis-like paragraph prose names", () => {
    const profile = loadProfile();
    const output = validOutput(profile);
    output.dynamic_parameters[11] = param(
      "customer_satisfaction_strength",
      "intended_end_state.minimum_success_criteria",
      {
        name: "Customer Satisfaction Strength",
        value_type: "prose",
        cell_budget: "paragraph",
      },
    );

    expect(() => validateParameterBuilderOutput(output, profile)).toThrow(
      ParameterValidationError,
    );
  });
});
