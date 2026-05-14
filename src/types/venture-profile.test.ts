import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIMENSION_KEYS,
  VentureProfileSchema,
} from "./venture-profile";

describe("VentureProfileSchema — ABB keystone round-trip", () => {
  const fixturePath = resolve(
    "test-cases/abb-rack-pdu/expected_profile.json",
  );

  it("parses the ABB expected_profile.json fixture without errors", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const result = VentureProfileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Schema rejected ABB fixture: ${JSON.stringify(
          result.error.format(),
          null,
          2,
        )}`,
      );
    }
    expect(result.data.venture_codename).toBe("VentureX");
  });

  it("preserves the load-bearing substitution_landscape (Section 13 acceptance hint)", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const parsed = VentureProfileSchema.parse(raw);
    const subs = parsed.dimensions.product_solution.substitution_landscape;
    expect(subs.length).toBeGreaterThanOrEqual(3);
    const haystack = subs.join(" | ").toLowerCase();
    // These should ALL be present per Section 13 of CLAUDE.md
    expect(haystack).toMatch(/busbar|busway/);
    expect(haystack).toMatch(/power shelf|power shelves/);
    expect(haystack).toMatch(/dc distribution/);
  });

  it("preserves implies_search_for on every strategic risk", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const parsed = VentureProfileSchema.parse(raw);
    for (const risk of parsed.strategic_risks_and_uncertainties) {
      expect(risk.implies_search_for.length).toBeGreaterThan(0);
    }
  });

  it("DIMENSION_KEYS covers all 7 dimensions exactly once", () => {
    expect(DIMENSION_KEYS).toHaveLength(7);
    expect(new Set(DIMENSION_KEYS).size).toBe(7);
  });
});

describe("VentureProfileSchema — D1 enforcement", () => {
  it("rejects the pre-D1 flat shape (dimensions at top level)", () => {
    const bad = {
      venture_codename: "VentureX",
      synthetic_description: "test",
      intended_end_state: {
        scale: "x",
        timeline_years: 3,
        minimum_success_criteria: "y",
      },
      current_maturity: "pre_concept",
      // FLAT — pre-D1 shape. Should fail because `dimensions` is missing.
      product_solution: {
        job_to_be_done: "x",
        solution_mechanism: "y",
        platform_or_pipe: "pipe",
        core_features: ["a"],
        substitution_landscape: ["a"],
        confidence: 0.5,
        supporting_quotes: [],
      },
      strategic_risks_and_uncertainties: [
        { risk: "x", implies_search_for: "y" },
      ],
      gaps_in_input: [],
    };
    expect(() => VentureProfileSchema.parse(bad)).toThrow();
  });

  it("rejects strategic_risks with empty implies_search_for", () => {
    const raw = JSON.parse(
      readFileSync(
        resolve("test-cases/abb-rack-pdu/expected_profile.json"),
        "utf-8",
      ),
    );
    // Corrupt one risk to have empty implies_search_for
    raw.strategic_risks_and_uncertainties[0].implies_search_for = "";
    expect(() => VentureProfileSchema.parse(raw)).toThrow();
  });

  it("rejects codename other than 'VentureX'", () => {
    const raw = JSON.parse(
      readFileSync(
        resolve("test-cases/abb-rack-pdu/expected_profile.json"),
        "utf-8",
      ),
    );
    raw.venture_codename = "VentureX-001"; // pre-D1 numbered codename
    expect(() => VentureProfileSchema.parse(raw)).toThrow();
  });
});
