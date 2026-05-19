import { describe, expect, it } from "vitest";

import type {
  CandidateDimensionScores,
  DimensionScoreCell,
} from "@/types/candidate-scoring";

import {
  WEIGHT_SUM_CEILING,
  WEIGHT_SUM_FLOOR,
  WeightSumDriftError,
  computeAggregateScore,
  type DimensionWeights,
} from "./aggregate";

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const cell = (score: number): DimensionScoreCell => ({
  score,
  rationale: "test cell",
  confidence: 0.5,
});

// Build a uniform score block (all 7 cells = the given value).
const uniformScores = (score: number): CandidateDimensionScores => ({
  product_solution: cell(score),
  customers: cell(score),
  transaction: cell(score),
  partners: cell(score),
  access: cell(score),
  geography_regulatory: cell(score),
  capital_asset: cell(score),
});

// Build a uniform weight set (all 7 weights = 1/7).
const UNIFORM_WEIGHTS: DimensionWeights = {
  product_solution: 1 / 7,
  customers: 1 / 7,
  transaction: 1 / 7,
  partners: 1 / 7,
  access: 1 / 7,
  geography_regulatory: 1 / 7,
  capital_asset: 1 / 7,
};

// Closer to a real ABB weight set: product_solution heavy, access light.
const ABB_LIKE_WEIGHTS: DimensionWeights = {
  product_solution: 0.26,
  customers: 0.1,
  transaction: 0.1,
  partners: 0.12,
  access: 0.04,
  geography_regulatory: 0.18,
  capital_asset: 0.2,
};

// ────────────────────────────────────────────────────────────────────────
// Happy path + boundaries
// ────────────────────────────────────────────────────────────────────────

describe("computeAggregateScore", () => {
  it("returns 1.0 when every cell is 1 (lowest possible aggregate)", () => {
    expect(computeAggregateScore(uniformScores(1), UNIFORM_WEIGHTS)).toBeCloseTo(
      1.0,
      10,
    );
  });

  it("returns 5.0 when every cell is 5 (highest possible aggregate)", () => {
    expect(computeAggregateScore(uniformScores(5), UNIFORM_WEIGHTS)).toBeCloseTo(
      5.0,
      10,
    );
  });

  it("returns 3.0 when every cell is 3 with uniform weights", () => {
    expect(computeAggregateScore(uniformScores(3), UNIFORM_WEIGHTS)).toBeCloseTo(
      3.0,
      10,
    );
  });

  it("returns 3.0 when every cell is 3 even with non-uniform (ABB-like) weights", () => {
    // Σ(3 × wᵢ) = 3 × Σwᵢ = 3 × 1.0 = 3.0 regardless of how weight mass is
    // distributed. This is the invariant that lets M15 compare aggregates
    // across ventures with different weight sets.
    expect(computeAggregateScore(uniformScores(3), ABB_LIKE_WEIGHTS)).toBeCloseTo(
      3.0,
      10,
    );
  });

  it("biases toward heavily-weighted dimensions", () => {
    // product_solution gets a 5; everything else gets a 1. With ABB weights
    // (product_solution = 0.26, others sum to 0.74), the expected aggregate is:
    //   5 × 0.26 + 1 × 0.74 = 1.30 + 0.74 = 2.04
    const scores: CandidateDimensionScores = {
      ...uniformScores(1),
      product_solution: cell(5),
    };
    expect(computeAggregateScore(scores, ABB_LIKE_WEIGHTS)).toBeCloseTo(
      2.04,
      10,
    );
  });

  it("biases away from heavily-weighted dimensions when scored low", () => {
    // Inverse: product_solution = 1, everything else = 5.
    //   1 × 0.26 + 5 × 0.74 = 0.26 + 3.70 = 3.96
    const scores: CandidateDimensionScores = {
      ...uniformScores(5),
      product_solution: cell(1),
    };
    expect(computeAggregateScore(scores, ABB_LIKE_WEIGHTS)).toBeCloseTo(
      3.96,
      10,
    );
  });

  it("ignores low-weight dimensions almost entirely (access = 0.04 in ABB)", () => {
    // access = 1 vs access = 5 should only swing the aggregate by 0.16 with
    // ABB weights (0.04 × 4 = 0.16). All other dims held at 3.
    const lowAccess: CandidateDimensionScores = {
      ...uniformScores(3),
      access: cell(1),
    };
    const highAccess: CandidateDimensionScores = {
      ...uniformScores(3),
      access: cell(5),
    };
    const delta =
      computeAggregateScore(highAccess, ABB_LIKE_WEIGHTS) -
      computeAggregateScore(lowAccess, ABB_LIKE_WEIGHTS);
    expect(delta).toBeCloseTo(0.16, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Defensive: weight sum drift
// ────────────────────────────────────────────────────────────────────────

describe("computeAggregateScore weight-sum guards", () => {
  it("accepts weights that sum to exactly the floor (0.95)", () => {
    // 7 × 0.13571... ≈ 0.95. Use 0.95 / 7 to get exactly the floor.
    const w = 0.95 / 7;
    const weights: DimensionWeights = {
      product_solution: w,
      customers: w,
      transaction: w,
      partners: w,
      access: w,
      geography_regulatory: w,
      capital_asset: w,
    };
    expect(() => computeAggregateScore(uniformScores(3), weights)).not.toThrow();
  });

  it("accepts weights that sum to exactly the ceiling (1.05)", () => {
    const w = 1.05 / 7;
    const weights: DimensionWeights = {
      product_solution: w,
      customers: w,
      transaction: w,
      partners: w,
      access: w,
      geography_regulatory: w,
      capital_asset: w,
    };
    expect(() => computeAggregateScore(uniformScores(3), weights)).not.toThrow();
  });

  it("throws WeightSumDriftError when weights sum below the floor", () => {
    const w = 0.05; // 7 × 0.05 = 0.35, well below 0.95
    const weights: DimensionWeights = {
      product_solution: w,
      customers: w,
      transaction: w,
      partners: w,
      access: w,
      geography_regulatory: w,
      capital_asset: w,
    };
    expect(() => computeAggregateScore(uniformScores(3), weights)).toThrow(
      WeightSumDriftError,
    );
  });

  it("throws WeightSumDriftError when weights sum above the ceiling", () => {
    const w = 0.5; // 7 × 0.5 = 3.5, well above 1.05
    const weights: DimensionWeights = {
      product_solution: w,
      customers: w,
      transaction: w,
      partners: w,
      access: w,
      geography_regulatory: w,
      capital_asset: w,
    };
    expect(() => computeAggregateScore(uniformScores(3), weights)).toThrow(
      WeightSumDriftError,
    );
  });

  it("WeightSumDriftError carries the observed sum for diagnostics", () => {
    const weights: DimensionWeights = {
      product_solution: 0,
      customers: 0,
      transaction: 0,
      partners: 0,
      access: 0,
      geography_regulatory: 0,
      capital_asset: 0,
    };
    try {
      computeAggregateScore(uniformScores(3), weights);
      expect.unreachable("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WeightSumDriftError);
      expect((err as WeightSumDriftError).sum).toBe(0);
      expect((err as WeightSumDriftError).floor).toBe(WEIGHT_SUM_FLOOR);
      expect((err as WeightSumDriftError).ceiling).toBe(WEIGHT_SUM_CEILING);
    }
  });
});
