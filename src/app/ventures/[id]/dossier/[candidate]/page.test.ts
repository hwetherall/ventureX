import { describe, expect, it } from "vitest";

import type { Parameter } from "@/types/parameter";
import type { CellTier, CellConfidence } from "@/types/cell";

import { computeEvidenceDensity } from "./page";

// ────────────────────────────────────────────────────────────────────────
// M15-F5: thin-evidence badge density calculation
// ────────────────────────────────────────────────────────────────────────

function makeParam(id: string, citationRequired: boolean): Parameter {
  return {
    id,
    name: id,
    tier: "framework",
    innovera_dimension: "product_solution",
    value_type: "prose",
    cell_budget: "sentence",
    citation_required: citationRequired,
    source_preference: ["official_company"],
    prompt_hint: "hint",
  };
}

interface FakeCell {
  id: string;
  parameter_key: string;
  tier: CellTier;
  value: unknown;
  citation: unknown;
  confidence: CellConfidence;
  reason: string | null;
  created_at: string;
}

const baseCellShape = {
  id: "cell-id",
  tier: "framework" as const,
  value: "some value",
  reason: null,
  created_at: "2026-05-20T00:00:00Z",
};

describe("computeEvidenceDensity", () => {
  it("returns showBadge=false when no citation-required cells exist", () => {
    const params = new Map<string, Parameter>([
      ["pipe_or_platform", makeParam("pipe_or_platform", false)],
    ]);
    const cells: FakeCell[] = [
      {
        ...baseCellShape,
        parameter_key: "pipe_or_platform",
        citation: null,
        confidence: "verified",
      },
    ];
    const out = computeEvidenceDensity(cells, params);
    expect(out.showBadge).toBe(false);
    expect(out.sampled).toBe(0);
  });

  it("returns showBadge=false on zero cells (no division by zero)", () => {
    const out = computeEvidenceDensity([], new Map());
    expect(out.showBadge).toBe(false);
    expect(out.sampled).toBe(0);
    expect(out.density).toBe(1);
  });

  it("excludes unknown cells from the denominator", () => {
    const params = new Map<string, Parameter>([
      ["core_offering", makeParam("core_offering", true)],
      ["margin_profile", makeParam("margin_profile", true)],
    ]);
    const cells: FakeCell[] = [
      {
        ...baseCellShape,
        parameter_key: "core_offering",
        citation: { url: "https://example.com/x" },
        confidence: "verified",
      },
      {
        ...baseCellShape,
        parameter_key: "margin_profile",
        citation: null,
        confidence: "unknown",
        value: null,
      },
    ];
    const out = computeEvidenceDensity(cells, params);
    expect(out.sampled).toBe(1);
    expect(out.density).toBe(1);
    expect(out.showBadge).toBe(false);
  });

  it("shows the badge when density is below the 40% threshold", () => {
    const params = new Map<string, Parameter>([
      ["a", makeParam("a", true)],
      ["b", makeParam("b", true)],
      ["c", makeParam("c", true)],
      ["d", makeParam("d", true)],
      ["e", makeParam("e", true)],
    ]);
    // 1 of 5 cited = 20% → badge shown
    const cells: FakeCell[] = [
      {
        ...baseCellShape,
        parameter_key: "a",
        citation: { url: "https://x" },
        confidence: "verified",
      },
      ...["b", "c", "d", "e"].map((key) => ({
        ...baseCellShape,
        parameter_key: key,
        citation: null,
        confidence: "verified" as const,
      })),
    ];
    const out = computeEvidenceDensity(cells, params);
    expect(out.density).toBeCloseTo(0.2, 5);
    expect(out.showBadge).toBe(true);
  });

  it("hides the badge when density is at or above 40%", () => {
    const params = new Map<string, Parameter>([
      ["a", makeParam("a", true)],
      ["b", makeParam("b", true)],
      ["c", makeParam("c", true)],
      ["d", makeParam("d", true)],
      ["e", makeParam("e", true)],
    ]);
    // 2 of 5 cited = 40% → badge NOT shown (threshold is strict <)
    const cells: FakeCell[] = [
      {
        ...baseCellShape,
        parameter_key: "a",
        citation: { url: "https://x" },
        confidence: "verified",
      },
      {
        ...baseCellShape,
        parameter_key: "b",
        citation: { url: "https://y" },
        confidence: "inferred",
      },
      ...["c", "d", "e"].map((key) => ({
        ...baseCellShape,
        parameter_key: key,
        citation: null,
        confidence: "verified" as const,
      })),
    ];
    const out = computeEvidenceDensity(cells, params);
    expect(out.density).toBeCloseTo(0.4, 5);
    expect(out.showBadge).toBe(false);
  });

  it("ignores cells whose parameter is not in the schema map", () => {
    const params = new Map<string, Parameter>();
    const cells: FakeCell[] = [
      {
        ...baseCellShape,
        parameter_key: "unknown_param",
        citation: null,
        confidence: "verified",
      },
    ];
    const out = computeEvidenceDensity(cells, params);
    expect(out.sampled).toBe(0);
    expect(out.showBadge).toBe(false);
  });
});
