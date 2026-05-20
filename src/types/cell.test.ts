import { describe, expect, it } from "vitest";

import {
  CellCitationSchema,
  CellRowSchema,
  Tier1BatchOutputSchema,
  Tier1CellOutputSchema,
  Tier2BatchOutputSchema,
  Tier2CellOutputSchema,
  Tier3CellOutputSchema,
  makeStrictTier1BatchSchema,
  makeStrictTier2BatchSchema,
} from "./cell";

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

const validCitation = {
  url: "https://www.se.com/about/founded",
  title: "About Schneider Electric",
  snippet: "Founded in 1836, Schneider Electric is headquartered in France.",
  retrieved_at: "2026-05-19T12:00:00Z",
};

const validVerifiedCell = (parameter_key: string) => ({
  parameter_key,
  value: 1836,
  citation: validCitation,
  confidence: "verified" as const,
});

const validUnknownCell = (parameter_key: string) => ({
  parameter_key,
  value: null,
  citation: null,
  confidence: "unknown" as const,
  reason: "no_evidence_found",
});

// ────────────────────────────────────────────────────────────────────────
// CellCitationSchema
// ────────────────────────────────────────────────────────────────────────

describe("CellCitationSchema", () => {
  it("accepts a valid citation", () => {
    expect(() => CellCitationSchema.parse(validCitation)).not.toThrow();
  });

  it("rejects non-URL urls", () => {
    expect(() =>
      CellCitationSchema.parse({ ...validCitation, url: "not a url" }),
    ).toThrow();
  });

  it("allows empty title (Exa often returns no title on PDF targets)", () => {
    expect(() =>
      CellCitationSchema.parse({ ...validCitation, title: "" }),
    ).not.toThrow();
  });

  it("rejects empty snippet", () => {
    expect(() =>
      CellCitationSchema.parse({ ...validCitation, snippet: "" }),
    ).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// CellRowSchema invariants
// ────────────────────────────────────────────────────────────────────────

describe("reason field cap (regression: dcim_software_attach extraction error)", () => {
  // Original schema had max(500) which caused an actual Tier 3 cell to fail
  // extraction twice when the model wrote a long no-evidence explanation.
  // Bumped to max(2000); this test pins the cap.
  it("accepts a 2000-character reason on Tier3CellOutputSchema", () => {
    const longReason = "x".repeat(2000);
    expect(() =>
      Tier3CellOutputSchema.parse({
        parameter_key: "dcim_software_attach",
        value: null,
        citation: null,
        confidence: "unknown",
        reason: longReason,
      }),
    ).not.toThrow();
  });

  it("rejects a 2001-character reason", () => {
    const tooLong = "x".repeat(2001);
    expect(() =>
      Tier3CellOutputSchema.parse({
        parameter_key: "dcim_software_attach",
        value: null,
        citation: null,
        confidence: "unknown",
        reason: tooLong,
      }),
    ).toThrow(/at most 2000/);
  });
});

describe("CellRowSchema", () => {
  const baseRow = {
    candidate_id: "11111111-1111-1111-1111-111111111111",
    parameter_key: "founded_year",
    tier: "universal" as const,
    value: 1836,
    citation: validCitation,
    confidence: "verified" as const,
    reason: null,
    llm_call_id: "22222222-2222-2222-2222-222222222222",
  };

  it("accepts a well-formed verified row", () => {
    expect(() => CellRowSchema.parse(baseRow)).not.toThrow();
  });

  it("accepts a verified row with null citation (T1 universal path)", () => {
    expect(() =>
      CellRowSchema.parse({ ...baseRow, citation: null }),
    ).not.toThrow();
  });

  it("rejects confidence='unknown' with non-null value", () => {
    expect(() =>
      CellRowSchema.parse({
        ...baseRow,
        confidence: "unknown",
        value: 1836,
        citation: null,
      }),
    ).toThrow(/value to be null/);
  });

  it("rejects confidence='unknown' with non-null citation", () => {
    expect(() =>
      CellRowSchema.parse({
        ...baseRow,
        confidence: "unknown",
        value: null,
        citation: validCitation,
      }),
    ).toThrow(/citation to be null/);
  });

  it("accepts confidence='unknown' with null value + null citation", () => {
    expect(() =>
      CellRowSchema.parse({
        ...baseRow,
        confidence: "unknown",
        value: null,
        citation: null,
        reason: "no_evidence_found",
      }),
    ).not.toThrow();
  });

  it("accepts confidence='verified' with null value (legitimately absent fact)", () => {
    // E.g., parent_company for a standalone public company. Schneider
    // Electric has no parent — `verified` + `value=null` is the honest
    // answer, not `unknown`.
    expect(() =>
      CellRowSchema.parse({ ...baseRow, value: null, citation: null }),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tier 1 — citation optional
// ────────────────────────────────────────────────────────────────────────

describe("Tier1CellOutputSchema", () => {
  it("accepts a cell with null citation (training-data only)", () => {
    expect(() =>
      Tier1CellOutputSchema.parse({
        parameter_key: "founded_year",
        value: 1836,
        citation: null,
        confidence: "verified",
      }),
    ).not.toThrow();
  });

  it("accepts a cell with citation present", () => {
    expect(() =>
      Tier1CellOutputSchema.parse(validVerifiedCell("founded_year")),
    ).not.toThrow();
  });

  it("accepts confidence='unknown' with null value", () => {
    expect(() =>
      Tier1CellOutputSchema.parse(validUnknownCell("founded_year")),
    ).not.toThrow();
  });

  it("accepts confidence='verified' with null value (legitimately absent fact)", () => {
    // parent_company for a standalone public company, stock_ticker for a
    // private company, etc. — the parameter's `value_schema: { nullable:
    // true }` permits these and the model returns null verified per the
    // prompt_hint.
    expect(() =>
      Tier1CellOutputSchema.parse({
        parameter_key: "parent_company",
        value: null,
        citation: null,
        confidence: "verified",
      }),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tier 2 — citation required unless unknown
// ────────────────────────────────────────────────────────────────────────

describe("Tier2CellOutputSchema", () => {
  it("accepts a verified cell with citation", () => {
    expect(() =>
      Tier2CellOutputSchema.parse(validVerifiedCell("core_offering")),
    ).not.toThrow();
  });

  it("accepts a verified cell with null citation (orchestrator enforces per-parameter)", () => {
    // The per-cell schema no longer enforces citation; the orchestrator
    // checks `citation_required` per parameter and downgrades to unknown
    // when the requirement is violated.
    expect(() =>
      Tier2CellOutputSchema.parse({
        parameter_key: "customer_segment_type",
        value: "B2B-E",
        citation: null,
        confidence: "verified",
      }),
    ).not.toThrow();
  });

  it("coerces empty list value to null when confidence='unknown'", () => {
    // Model commonly returns `[]` for list-typed parameters under uncertainty.
    const parsed = Tier2CellOutputSchema.parse({
      parameter_key: "supply_partners",
      value: [],
      citation: null,
      confidence: "unknown",
    });
    expect((parsed as { value: unknown }).value).toBeNull();
  });

  it("coerces empty object value to null when confidence='unknown'", () => {
    const parsed = Tier2CellOutputSchema.parse({
      parameter_key: "pricing_disclosure",
      value: {},
      citation: null,
      confidence: "unknown",
    });
    expect((parsed as { value: unknown }).value).toBeNull();
  });

  it("coerces whitespace-only string value to null when confidence='unknown'", () => {
    const parsed = Tier2CellOutputSchema.parse({
      parameter_key: "core_offering",
      value: "   ",
      citation: null,
      confidence: "unknown",
    });
    expect((parsed as { value: unknown }).value).toBeNull();
  });

  it("preserves non-empty value when confidence='verified'", () => {
    const parsed = Tier2CellOutputSchema.parse({
      parameter_key: "core_offering",
      value: "Power distribution products.",
      citation: validCitation,
      confidence: "verified",
    });
    expect((parsed as { value: unknown }).value).toBe("Power distribution products.");
  });

  it("accepts a verified cell with null value if cited (verified absence)", () => {
    // E.g., "Citation confirms the company has no parent."
    expect(() =>
      Tier2CellOutputSchema.parse({
        parameter_key: "customer_concentration",
        value: null,
        citation: validCitation,
        confidence: "verified",
      }),
    ).not.toThrow();
  });

  it("accepts confidence='unknown' with null value + null citation", () => {
    expect(() =>
      Tier2CellOutputSchema.parse(validUnknownCell("core_offering")),
    ).not.toThrow();
  });

  it("rejects confidence='unknown' with citation present", () => {
    expect(() =>
      Tier2CellOutputSchema.parse({
        parameter_key: "core_offering",
        value: null,
        citation: validCitation,
        confidence: "unknown",
      }),
    ).toThrow(/citation to be null/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tier 3 — citation required from supplied Exa hits unless unknown
// ────────────────────────────────────────────────────────────────────────

describe("Tier3CellOutputSchema", () => {
  it("accepts a verified cell with citation", () => {
    expect(() =>
      Tier3CellOutputSchema.parse(
        validVerifiedCell("latest_product_announcement"),
      ),
    ).not.toThrow();
  });

  it("rejects a verified cell with null citation", () => {
    expect(() =>
      Tier3CellOutputSchema.parse({
        parameter_key: "latest_product_announcement",
        value: "Schneider announced EcoStruxure DC IT in 2025-Q4.",
        citation: null,
        confidence: "verified",
      }),
    ).toThrow(/Tier 3 cells require a citation/);
  });

  it("accepts confidence='unknown' for design doc §Tier 3 fallback chain", () => {
    expect(() =>
      Tier3CellOutputSchema.parse(
        validUnknownCell("latest_product_announcement"),
      ),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Batch + strict factory
// ────────────────────────────────────────────────────────────────────────

describe("Tier1BatchOutputSchema (shape-only)", () => {
  it("accepts a non-empty cells array", () => {
    expect(() =>
      Tier1BatchOutputSchema.parse({
        cells: [validVerifiedCell("founded_year")],
      }),
    ).not.toThrow();
  });

  it("rejects empty cells array", () => {
    expect(() =>
      Tier1BatchOutputSchema.parse({ cells: [] }),
    ).toThrow();
  });
});

describe("makeStrictTier1BatchSchema", () => {
  const expected = ["founded_year", "hq_location", "headcount"];

  it("accepts a batch covering every expected key exactly once", () => {
    const schema = makeStrictTier1BatchSchema(expected);
    const data = {
      cells: expected.map((k) => validVerifiedCell(k)),
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it("rejects when cell count differs from expected count", () => {
    const schema = makeStrictTier1BatchSchema(expected);
    const data = {
      cells: [validVerifiedCell("founded_year")],
    };
    expect(() => schema.parse(data)).toThrow(
      /cells\.length \(1\) must equal expected parameter count \(3\)/,
    );
  });

  it("rejects when an expected key is missing", () => {
    const schema = makeStrictTier1BatchSchema(expected);
    const data = {
      cells: [
        validVerifiedCell("founded_year"),
        validVerifiedCell("hq_location"),
        validVerifiedCell("hq_location"), // duplicate covering for headcount
      ],
    };
    expect(() => schema.parse(data)).toThrow(/missing parameter_key/);
  });

  it("rejects when output contains an unexpected key", () => {
    const schema = makeStrictTier1BatchSchema(expected);
    const data = {
      cells: [
        validVerifiedCell("founded_year"),
        validVerifiedCell("hq_location"),
        validVerifiedCell("bogus_invented_param"),
      ],
    };
    expect(() => schema.parse(data)).toThrow(/unexpected parameter_key/);
  });

  it("rejects duplicate parameter_keys in output", () => {
    const schema = makeStrictTier1BatchSchema(expected);
    const data = {
      cells: [
        validVerifiedCell("founded_year"),
        validVerifiedCell("hq_location"),
        validVerifiedCell("hq_location"),
      ],
    };
    expect(() => schema.parse(data)).toThrow(/duplicate parameter_key/);
  });
});

describe("makeStrictTier2BatchSchema", () => {
  const expected = ["core_offering", "differentiating_mechanism"];

  it("accepts a well-formed Tier 2 batch", () => {
    const schema = makeStrictTier2BatchSchema(expected);
    const data = {
      cells: expected.map((k) => validVerifiedCell(k)),
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  it("accepts a Tier 2 batch with citation-less verified cells (orchestrator enforces)", () => {
    // Per-cell citation requirement moved to the orchestrator so it can
    // honour the parameter's `citation_required` flag. The schema layer
    // accepts the shape; the orchestrator downgrades unmet requirements.
    const schema = makeStrictTier2BatchSchema(expected);
    const data = {
      cells: [
        validVerifiedCell("core_offering"),
        {
          parameter_key: "differentiating_mechanism",
          value: "Open standards plus deep installed base.",
          citation: null,
          confidence: "verified" as const,
        },
      ],
    };
    expect(() => schema.parse(data)).not.toThrow();
  });
});
