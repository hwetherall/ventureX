import { describe, expect, it } from "vitest";

import { ResearchBudgetError } from "./errors";
import { ResearchBudgetTracker } from "./budget";

describe("ResearchBudgetTracker", () => {
  it("reserves and settles concurrent provider spend", () => {
    const budget = new ResearchBudgetTracker(5, 10);
    const releaseA = budget.reserve(2);
    const releaseB = budget.reserve(3);
    expect(budget.snapshot().reservedUsd).toBe(5);
    budget.settle(2, 1.5, releaseA);
    budget.settle(3, 2.5, releaseB);
    expect(budget.spentUsd).toBe(4);
    expect(budget.snapshot().reservedUsd).toBe(0);
  });

  it("blocks reservations above the hard cap", () => {
    const budget = new ResearchBudgetTracker(5, 10);
    budget.reserve(9);
    expect(() => budget.reserve(2)).toThrow(ResearchBudgetError);
  });
});
