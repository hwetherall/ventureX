import { describe, expect, it } from "vitest";

import {
  type ComparisonCandidate,
  describeDimensionScores,
  formatScore,
  rankCandidatesByScore,
} from "./table-viewer";

function candidate(
  name: string,
  aggregate: number | null,
): ComparisonCandidate {
  return {
    candidate_id: name.toLowerCase(),
    name,
    product_line: null,
    logo_url: null,
    aggregate_score: aggregate,
    stats: { total: 0, verified: 0, inferred: 0, unknown: 0 },
  };
}

describe("rankCandidatesByScore", () => {
  it("orders scored candidates by aggregate descending and assigns 1-based ranks", () => {
    const ranked = rankCandidatesByScore([
      candidate("Low", 2.1),
      candidate("High", 4.6),
      candidate("Mid", 3.3),
    ]);
    expect(ranked.map((c) => [c.name, c.rank])).toEqual([
      ["High", 1],
      ["Mid", 2],
      ["Low", 3],
    ]);
  });

  it("puts unscored candidates after every scored candidate, rank null, input order preserved", () => {
    const ranked = rankCandidatesByScore([
      candidate("Unscored A", null),
      candidate("Scored", 1.5),
      candidate("Unscored B", null),
    ]);
    expect(ranked.map((c) => [c.name, c.rank])).toEqual([
      ["Scored", 1],
      ["Unscored A", null],
      ["Unscored B", null],
    ]);
  });

  it("breaks aggregate ties alphabetically for stable re-renders", () => {
    const ranked = rankCandidatesByScore([
      candidate("Zeta", 3.0),
      candidate("Alpha", 3.0),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("treats a non-finite aggregate as unscored", () => {
    const ranked = rankCandidatesByScore([
      candidate("NaN co", Number.NaN),
      candidate("Real co", 2.0),
    ]);
    expect(ranked.map((c) => [c.name, c.rank])).toEqual([
      ["Real co", 1],
      ["NaN co", null],
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [candidate("B", 1.0), candidate("A", 5.0)];
    rankCandidatesByScore(input);
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
    expect(input[0]!.rank).toBeUndefined();
  });
});

describe("formatScore", () => {
  it("formats to two decimals", () => {
    expect(formatScore(4)).toBe("4.00");
    expect(formatScore(3.456)).toBe("3.46");
  });
});

describe("describeDimensionScores", () => {
  it("returns empty string for missing scores", () => {
    expect(describeDimensionScores(null)).toBe("");
    expect(describeDimensionScores(undefined)).toBe("");
  });

  it("joins short labels with scores", () => {
    const text = describeDimensionScores({
      product_solution: { score: 5, rationale: "r", confidence: 1 },
      access: { score: 2, rationale: "r", confidence: 0.4 },
    });
    expect(text).toBe("Product 5/5 · Access 2/5");
  });
});
