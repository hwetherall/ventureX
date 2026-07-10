import { describe, expect, it } from "vitest";

import {
  prepareInvestorReportData,
  selectReportCandidates,
  selectReportParameters,
  type InvestorReportWeight,
} from "@/lib/investor-report-data";
import { sampleProfile } from "@/lib/investor-report-fixture.test-helper";
import type {
  ComparisonCandidate,
  ComparisonParameter,
  ComparisonTableData,
} from "@/lib/table-viewer";
import { DIMENSION_KEYS } from "@/types/venture-profile";

function parameter(tier: 1 | 2 | 3, index: number): ComparisonParameter {
  return {
    parameter_key: `t${tier}_${index}`,
    parameter_label: `Tier ${tier} parameter ${index}`,
    tier,
    description: `Description ${index}`,
    value_shape: "string",
  };
}

function candidate(
  name: string,
  rank: number | null,
  aggregateScore: number | null,
): ComparisonCandidate {
  return {
    candidate_id: name.toLowerCase(),
    name,
    product_line: null,
    logo_url: null,
    rank,
    aggregate_score: aggregateScore,
    dimension_scores: null,
    stats: { total: 0, verified: 0, inferred: 0, unknown: 0 },
  };
}

describe("investor report selection", () => {
  it("selects 3/4/3 parameters spread across all research tiers", () => {
    const parameters = [
      ...Array.from({ length: 6 }, (_, index) => parameter(1, index)),
      ...Array.from({ length: 8 }, (_, index) => parameter(2, index)),
      ...Array.from({ length: 6 }, (_, index) => parameter(3, index)),
    ];

    const selected = selectReportParameters(parameters);

    expect(selected).toHaveLength(10);
    expect(selected.filter((item) => item.tier === 1)).toHaveLength(3);
    expect(selected.filter((item) => item.tier === 2)).toHaveLength(4);
    expect(selected.filter((item) => item.tier === 3)).toHaveLength(3);
    expect(selected.map((item) => item.parameter_key)).toEqual([
      "t1_0",
      "t1_3",
      "t1_5",
      "t2_0",
      "t2_2",
      "t2_5",
      "t2_7",
      "t3_0",
      "t3_3",
      "t3_5",
    ]);
  });

  it("takes the top three by rank regardless of input order", () => {
    const selected = selectReportCandidates([
      candidate("Third", 3, 3.7),
      candidate("Unscored", null, null),
      candidate("First", 1, 4.6),
      candidate("Second", 2, 4.1),
    ]);

    expect(selected.map((item) => item.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("filters the working matrix down to the focused 3 x 10 appendix", () => {
    const parameters = [
      ...Array.from({ length: 6 }, (_, index) => parameter(1, index)),
      ...Array.from({ length: 8 }, (_, index) => parameter(2, index)),
      ...Array.from({ length: 6 }, (_, index) => parameter(3, index)),
    ];
    const candidates = [
      candidate("First", 1, 4.6),
      candidate("Second", 2, 4.1),
      candidate("Third", 3, 3.7),
      candidate("Fourth", 4, 3.5),
    ];
    const table: ComparisonTableData = {
      venture: {
        id: "venture-1",
        slug: "venturex",
        title: "VentureX",
        generated_at: "2026-07-09T00:00:00.000Z",
      },
      candidates,
      parameters,
      cells: candidates.flatMap((item) =>
        parameters.map((itemParameter) => ({
          candidate_id: item.candidate_id,
          parameter_key: itemParameter.parameter_key,
          tier: itemParameter.tier,
          confidence: "verified" as const,
          value: "Evidence",
          citations: [],
          reason: null,
          retrieved_at: null,
        })),
      ),
    };
    const profile = sampleProfile();
    const weights = DIMENSION_KEYS.map((dimension) => ({
      dimension,
      weight: 1 / 7,
      rationale: `Why ${dimension} matters`,
    })) satisfies InvestorReportWeight[];
    const details = new Map(
      candidates.map((item) => [
        item.candidate_id,
        {
          id: item.candidate_id,
          rationale: `${item.name} rationale`,
          citations: [],
        },
      ]),
    );

    const report = prepareInvestorReportData(table, profile, weights, details);

    expect(report.candidates).toHaveLength(3);
    expect(report.parameters).toHaveLength(10);
    expect(report.cells).toHaveLength(30);
    expect(report.source_counts).toEqual({ candidates: 4, parameters: 20 });
  });
});
