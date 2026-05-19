import { describe, expect, it } from "vitest";

import type { VentureProfile } from "@/types/venture-profile";

import {
  assembleParameterPrompt,
  buildCoverageChecklist,
} from "./stage4-parameters";

// ────────────────────────────────────────────────────────────────────────
// Regression tests for the /investigate 2026-05-19 fix
//
// Root cause: model mapped parameters to risk topics rather than literal
// source_field indices, leaving strategic_risks_and_uncertainties[4]
// uncovered and tripping assertRiskCoverage.
//
// Fix layer 2 (this file's coverage): orchestrator now injects a numbered
// RISK + SUBSTITUTION COVERAGE CHECKLIST into the prompt and supports a
// corrective-feedback retry path.
// ────────────────────────────────────────────────────────────────────────

// Minimal profile shape just sufficient for assembleParameterPrompt /
// buildCoverageChecklist to traverse. Not a full VentureProfile — we
// only need substitution_landscape and strategic_risks_and_uncertainties
// to be populated; the rest is filled with type-correct placeholders so
// the JSON.stringify roundtrip in assembleParameterPrompt doesn't blow up.
function makeMinimalProfile(): VentureProfile {
  return {
    venture_codename: "VentureX",
    synthetic_description: "test venture",
    intended_end_state: {
      scale: "test scale",
      timeline_years: 3,
      minimum_success_criteria: "test criteria",
    },
    current_maturity: "pre_concept",
    dimensions: {
      product_solution: {
        job_to_be_done: "test job",
        solution_mechanism: "test mechanism",
        platform_or_pipe: "pipe",
        core_features: ["feature1"],
        substitution_landscape: [
          "Busway / busbar overhead distribution",
          "Power shelves: in-rack DC supplies",
          "DC distribution at the rack level",
        ],
        confidence: 0.9,
        supporting_quotes: [],
      },
      customers: {
        segment_type: "B2B-Enterprise",
        buyer: "test buyer",
        user: "test user",
        target_sub_segments: ["seg1"],
        buyer_sophistication: "high",
        confidence: 0.9,
        supporting_quotes: [],
      },
      transaction: {
        model: "unit_sales",
        typical_deal_size_usd: "100k",
        margin_profile: "medium",
        revenue_recurrence: "one_time",
        confidence: 0.9,
        supporting_quotes: [],
      },
      partners: {
        distribution_channels: ["ch1"],
        key_suppliers: ["s1"],
        regulators_certifications: ["UL"],
        system_integrators_resellers: [],
        complementary_product_partners: [],
        confidence: 0.9,
        supporting_quotes: [],
      },
      access: {
        learn: "ad",
        reach: "ad",
        acquire: "ad",
        maintain: "ad",
        access_intensity: "low",
        confidence: 0.9,
        supporting_quotes: [],
      },
      geography_regulatory: {
        target_geographies: ["US"],
        accessible_market_constraints: [],
        regulatory_regime: "Light",
        localization_requirements: [],
        confidence: 0.9,
        supporting_quotes: [],
      },
      capital_asset: {
        capital_intensity: "high",
        asset_type: "hardware",
        manufacturing_footprint: "global",
        defensibility_model: "scale",
        time_to_revenue_years: 2,
        confidence: 0.9,
        supporting_quotes: [],
      },
    },
    strategic_risks_and_uncertainties: [
      {
        risk: "AI density risk",
        implies_search_for: "busbar vendors",
      },
      {
        risk: "DC distribution risk",
        implies_search_for: "DC vendors",
      },
      {
        risk: "Channel mismatch",
        implies_search_for: "IT-channel incumbents",
      },
      {
        risk: "Commoditization pressure",
        implies_search_for: "low-cost manufacturers",
      },
      {
        risk: "Acquisition complexity",
        implies_search_for: "small fragmented targets",
      },
      {
        risk: "Geography accessibility",
        implies_search_for: "Chinese domestic vendors",
      },
    ],
    gaps_in_input: [],
  };
}

describe("buildCoverageChecklist", () => {
  it("enumerates every substitution_landscape entry with its literal source_field", () => {
    const profile = makeMinimalProfile();
    const checklist = buildCoverageChecklist(profile);

    for (let i = 0; i < profile.dimensions.product_solution.substitution_landscape.length; i++) {
      expect(checklist).toContain(
        `dimensions.product_solution.substitution_landscape[${i}]`,
      );
    }
  });

  it("enumerates every strategic_risks_and_uncertainties entry with its literal index prefix", () => {
    const profile = makeMinimalProfile();
    const checklist = buildCoverageChecklist(profile);

    for (let i = 0; i < profile.strategic_risks_and_uncertainties.length; i++) {
      expect(checklist).toContain(
        `strategic_risks_and_uncertainties[${i}]`,
      );
    }
  });

  it("includes risk[4] explicitly — the index that originally got dropped", () => {
    // This is the regression test for the /investigate 2026-05-19 root cause.
    // The original failure was that risk[4] (acquisitions) got 0 params; the
    // model needs the literal index in the prompt to map to it correctly.
    const profile = makeMinimalProfile();
    const checklist = buildCoverageChecklist(profile);

    expect(checklist).toContain("strategic_risks_and_uncertainties[4]");
    expect(checklist).toContain("Acquisition complexity");
  });

  it("calls out the literal-vs-topical match requirement", () => {
    const profile = makeMinimalProfile();
    const checklist = buildCoverageChecklist(profile);

    expect(checklist).toMatch(/literal|literally/i);
    expect(checklist).toMatch(/topical|topic|topical alignment/i);
  });
});

describe("assembleParameterPrompt", () => {
  // Empty CanonicalWeights placeholder (tests don't exercise the weights path).
  const NULL_WEIGHTS = Object.fromEntries(
    [
      "product_solution",
      "customers",
      "transaction",
      "partners",
      "access",
      "geography_regulatory",
      "capital_asset",
    ].map((k) => [
      k,
      { weight: 1 / 7, rationale: "test", source: "llm_proposed" },
    ]),
  );

  const PROMPT_BODY_WITH_PLACEHOLDER =
    "# ROLE\n\nYou are a tester.\n\n# INPUT\n\n[The VentureX profile JSON, canonical dimension weights, and prior parameter generations will be appended below]";

  it("injects the coverage checklist below the profile and before the weights", () => {
    const profile = makeMinimalProfile();
    const prompt = assembleParameterPrompt(
      PROMPT_BODY_WITH_PLACEHOLDER,
      profile,
      NULL_WEIGHTS as never,
      [],
    );

    const profileIdx = prompt.indexOf("## VentureX profile (JSON)");
    const checklistIdx = prompt.indexOf("## RISK + SUBSTITUTION COVERAGE CHECKLIST");
    const weightsIdx = prompt.indexOf("## Canonical dimension weights");

    expect(profileIdx).toBeGreaterThan(-1);
    expect(checklistIdx).toBeGreaterThan(profileIdx);
    expect(weightsIdx).toBeGreaterThan(checklistIdx);
  });

  it("omits the corrective-feedback block on first-attempt assembly", () => {
    const prompt = assembleParameterPrompt(
      PROMPT_BODY_WITH_PLACEHOLDER,
      makeMinimalProfile(),
      NULL_WEIGHTS as never,
      [],
    );

    expect(prompt).not.toContain("## RETRY");
    expect(prompt).not.toContain("PREVIOUS ATTEMPT FAILED VALIDATION");
  });

  it("appends the corrective-feedback block at the END of the prompt on retry", () => {
    const correctiveFeedback =
      "Expected at least one dynamic parameter sourced from strategic_risks_and_uncertainties[4].";
    const prompt = assembleParameterPrompt(
      PROMPT_BODY_WITH_PLACEHOLDER,
      makeMinimalProfile(),
      NULL_WEIGHTS as never,
      [],
      correctiveFeedback,
    );

    expect(prompt).toContain("## RETRY — PREVIOUS ATTEMPT FAILED VALIDATION");
    expect(prompt).toContain(correctiveFeedback);

    // Corrective feedback must come AFTER the profile + checklist so the model
    // re-reads them with the gap fresh in context.
    const profileIdx = prompt.indexOf("## VentureX profile (JSON)");
    const checklistIdx = prompt.indexOf("## RISK + SUBSTITUTION COVERAGE CHECKLIST");
    const retryIdx = prompt.indexOf("## RETRY");

    expect(retryIdx).toBeGreaterThan(profileIdx);
    expect(retryIdx).toBeGreaterThan(checklistIdx);
  });
});
