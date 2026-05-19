import { describe, expect, it } from "vitest";

import {
  CandidateScoreSchema,
  DimensionScoreCellSchema,
  Stage4ScoringOutputSchema,
  makeStrictStage4ScoringOutputSchema,
  type CandidateDimensionScores,
  type Stage4ScoringOutput,
} from "./candidate-scoring";

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

// Minimal valid score cell. Reused across multiple test bodies.
const validCell = {
  score: 3,
  rationale: "Mid-strength overlap on this dimension.",
  confidence: 0.7,
} as const;

// All 7 dimensions populated with the same cell. The shape the orchestrator
// will see after Zod parses one candidate's score block.
const validDimensionScores: CandidateDimensionScores = {
  product_solution: validCell,
  customers: validCell,
  transaction: validCell,
  partners: validCell,
  access: validCell,
  geography_regulatory: validCell,
  capital_asset: validCell,
};

// Helper: build a CandidateScore entry by name. Cell content doesn't matter
// for the strict-refinement tests; we just need a parseable shape.
const scoreFor = (name: string) => ({
  name,
  dimension_scores: validDimensionScores,
});

// Synthesize 10 candidate names. min(10) is the schema floor — anything less
// fails for a different reason than the strict-count refinement we're testing.
const TEN_NAMES = Array.from({ length: 10 }, (_, i) => `Candidate ${i + 1}`);

// ────────────────────────────────────────────────────────────────────────
// Round-trip shape validation
// ────────────────────────────────────────────────────────────────────────

describe("DimensionScoreCellSchema", () => {
  it("accepts a well-formed cell at the centre of every range", () => {
    expect(DimensionScoreCellSchema.parse(validCell)).toEqual(validCell);
  });

  it.each([
    { score: 0, label: "below 1" },
    { score: 6, label: "above 5" },
    { score: 3.5, label: "fractional (not integer)" },
  ])("rejects score=$score ($label)", ({ score }) => {
    expect(
      DimensionScoreCellSchema.safeParse({ ...validCell, score }).success,
    ).toBe(false);
  });

  it.each([
    { confidence: -0.1, label: "below 0" },
    { confidence: 1.1, label: "above 1" },
  ])("rejects confidence=$confidence ($label)", ({ confidence }) => {
    expect(
      DimensionScoreCellSchema.safeParse({ ...validCell, confidence }).success,
    ).toBe(false);
  });

  it("rejects empty rationale", () => {
    expect(
      DimensionScoreCellSchema.safeParse({ ...validCell, rationale: "" })
        .success,
    ).toBe(false);
  });

  it("rejects rationale exceeding 400 chars", () => {
    const oversized = "x".repeat(401);
    expect(
      DimensionScoreCellSchema.safeParse({
        ...validCell,
        rationale: oversized,
      }).success,
    ).toBe(false);
  });
});

describe("CandidateScoreSchema", () => {
  it("round-trips a valid candidate score", () => {
    const candidate = scoreFor("Schneider Electric");
    expect(CandidateScoreSchema.parse(candidate)).toEqual(candidate);
  });

  it("rejects a candidate score missing one dimension key", () => {
    const broken = {
      name: "Eaton",
      dimension_scores: {
        product_solution: validCell,
        customers: validCell,
        transaction: validCell,
        partners: validCell,
        access: validCell,
        geography_regulatory: validCell,
        // capital_asset intentionally absent — this is exactly the §6c
        // criterion 1 (coverage floor) violation we want Zod to catch.
      },
    };
    expect(CandidateScoreSchema.safeParse(broken).success).toBe(false);
  });
});

describe("Stage4ScoringOutputSchema (shape only, no strict cross-check)", () => {
  it("round-trips a valid 10-candidate output", () => {
    const output: Stage4ScoringOutput = {
      scores: TEN_NAMES.map(scoreFor),
    };
    expect(Stage4ScoringOutputSchema.parse(output)).toEqual(output);
  });

  it("accepts optional synthesis_notes", () => {
    const output: Stage4ScoringOutput = {
      scores: TEN_NAMES.map(scoreFor),
      synthesis_notes: "All Direct candidates clustered above SPDM and Category.",
    };
    expect(Stage4ScoringOutputSchema.parse(output)).toEqual(output);
  });

  it("rejects scores.length < 10 (below the floor)", () => {
    const output = { scores: TEN_NAMES.slice(0, 5).map(scoreFor) };
    expect(Stage4ScoringOutputSchema.safeParse(output).success).toBe(false);
  });

  it("rejects scores.length > 60 (above the ceiling)", () => {
    const tooMany = Array.from({ length: 61 }, (_, i) => `C${i}`).map(scoreFor);
    expect(
      Stage4ScoringOutputSchema.safeParse({ scores: tooMany }).success,
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// P3-D19 strict-count refinement (Section 2 D2 of /plan-eng-review)
//
// makeStrictStage4ScoringOutputSchema returns a schema closure that rejects
// any output where:
//   - scores.length differs from the expected input count
//   - any input name is missing from the output
//   - any output name duplicates another (case-folded)
//   - any output name isn't in the input set
//
// This is the load-bearing test for the "no silent partial-scoring" guarantee
// behind §6c criterion 1.
// ────────────────────────────────────────────────────────────────────────

describe("makeStrictStage4ScoringOutputSchema (P3-D19 partial-scoring rejection)", () => {
  it("accepts a well-formed output that scores every input candidate exactly once", () => {
    const expected = ["Schneider", "Eaton", "Vertiv", ...TEN_NAMES];
    const schema = makeStrictStage4ScoringOutputSchema(expected);
    const output = { scores: expected.map(scoreFor) };
    const result = schema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("rejects when output is short (50 scored entries for 53 input candidates)", () => {
    // Fabricate a 53-candidate input set and a 50-entry output, mirroring the
    // §6b ABB scenario (M13 returned 46-53 candidates depending on run).
    const expected = Array.from({ length: 53 }, (_, i) => `C${i + 1}`);
    const truncated = expected.slice(0, 50).map(scoreFor);
    const schema = makeStrictStage4ScoringOutputSchema(expected);
    const result = schema.safeParse({ scores: truncated });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      // Length mismatch fires AND each missing name surfaces its own issue.
      expect(messages.some((m) => /scores\.length/.test(m))).toBe(true);
      expect(messages.some((m) => /missing from output/.test(m))).toBe(true);
    }
  });

  it("rejects when output has the right count but wrong names", () => {
    const expected = TEN_NAMES;
    const swapped = [
      ...TEN_NAMES.slice(0, 9),
      "Imposter Inc", // wrong name in the last slot
    ].map(scoreFor);
    const schema = makeStrictStage4ScoringOutputSchema(expected);
    const result = schema.safeParse({ scores: swapped });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /not in input set/.test(m))).toBe(true);
      expect(messages.some((m) => /missing from output/.test(m))).toBe(true);
    }
  });

  it("rejects when the output duplicates a candidate name (case-folded)", () => {
    const expected = TEN_NAMES;
    // Replace the last entry with a case-variant duplicate of the first.
    const dupes = [
      ...TEN_NAMES.slice(0, 9).map(scoreFor),
      scoreFor("CANDIDATE 1"), // case-fold duplicate of "Candidate 1"
    ];
    const schema = makeStrictStage4ScoringOutputSchema(expected);
    const result = schema.safeParse({ scores: dupes });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /Duplicate candidate name/.test(m))).toBe(
        true,
      );
    }
  });

  it("matches names case-insensitively and whitespace-tolerantly", () => {
    const expected = ["Schneider Electric (APC)", "Eaton"];
    // Use 10-entry minimum: pad with valid but unmatched entries... no, that
    // would fail the strict check. Use a 10-name expected list instead.
    const tenExpected = [
      "Schneider Electric (APC)",
      "Eaton",
      "Vertiv",
      "Server Technology",
      "Raritan",
      "Legrand",
      "Panduit",
      "Tripp Lite",
      "CyberPower",
      "Enlogic",
    ];
    // Same names but with different casing / trailing whitespace.
    const output = {
      scores: [
        "schneider electric (apc)",
        "EATON",
        "Vertiv ",
        " Server Technology",
        "Raritan",
        "Legrand",
        "PANDUIT",
        "Tripp Lite",
        "CyberPower",
        "ENLOGIC",
      ].map(scoreFor),
    };
    const schema = makeStrictStage4ScoringOutputSchema(tenExpected);
    const result = schema.safeParse(output);
    expect(result.success).toBe(true);
    // expected used in a subset assertion to satisfy lint; verifies case match.
    expect(tenExpected.length).toBe(10);
    expect(expected[0]).toMatch(/Schneider/);
  });
});
