import { ResearchBudgetError } from "./errors";

export class ResearchBudgetTracker {
  private reservedUsd = 0;
  private actualUsd = 0;

  constructor(
    readonly softCapUsd: number,
    readonly hardCapUsd: number,
  ) {
    if (!(softCapUsd > 0) || !(hardCapUsd >= softCapUsd)) {
      throw new Error("Research budget requires 0 < soft cap <= hard cap");
    }
  }

  reserve(estimatedUsd: number): () => void {
    if (estimatedUsd < 0 || !Number.isFinite(estimatedUsd)) {
      throw new Error("Research reservation must be a non-negative number");
    }
    if (this.actualUsd + this.reservedUsd + estimatedUsd > this.hardCapUsd) {
      throw new ResearchBudgetError(
        this.actualUsd + this.reservedUsd,
        estimatedUsd,
        this.hardCapUsd,
      );
    }
    this.reservedUsd += estimatedUsd;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reservedUsd = Math.max(0, this.reservedUsd - estimatedUsd);
    };
  }

  settle(estimatedUsd: number, actualUsd: number, release: () => void): void {
    release();
    if (actualUsd < 0 || !Number.isFinite(actualUsd)) {
      throw new Error("Research actual cost must be a non-negative number");
    }
    if (this.actualUsd + this.reservedUsd + actualUsd > this.hardCapUsd) {
      throw new ResearchBudgetError(
        this.actualUsd + this.reservedUsd,
        actualUsd,
        this.hardCapUsd,
      );
    }
    this.actualUsd += actualUsd;
    void estimatedUsd;
  }

  get spentUsd(): number {
    return this.actualUsd;
  }

  get isAboveSoftCap(): boolean {
    return this.actualUsd + this.reservedUsd > this.softCapUsd;
  }

  snapshot() {
    return {
      softCapUsd: this.softCapUsd,
      hardCapUsd: this.hardCapUsd,
      spentUsd: this.actualUsd,
      reservedUsd: this.reservedUsd,
      isAboveSoftCap: this.isAboveSoftCap,
    };
  }
}

export function researchBudgetFromEnvironment(): ResearchBudgetTracker {
  return new ResearchBudgetTracker(
    parsePositive(process.env.CELL_RESEARCH_V2_SOFT_CAP_USD, 5),
    parsePositive(process.env.CELL_RESEARCH_V2_HARD_CAP_USD, 8),
  );
}

/**
 * Perplexity is an explicitly authorized post-pass, so it has an incremental
 * budget independent from the ordinary 3x10 acquisition budget.
 */
export function perplexityBudgetFromEnvironment(): ResearchBudgetTracker {
  return new ResearchBudgetTracker(
    parsePositive(process.env.CELL_RESEARCH_PERPLEXITY_SOFT_CAP_USD, 4),
    parsePositive(process.env.CELL_RESEARCH_PERPLEXITY_HARD_CAP_USD, 6),
  );
}

export function perplexityCellReservationFromEnvironment(): number {
  return parsePositive(
    process.env.CELL_RESEARCH_PERPLEXITY_CELL_RESERVATION_USD,
    1.25,
  );
}

function parsePositive(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
