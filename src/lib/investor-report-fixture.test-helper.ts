import type {
  InvestorReportData,
  InvestorReportWeight,
} from "@/lib/investor-report-data";
import { DIMENSION_KEYS, VentureProfileSchema } from "@/types/venture-profile";

export function sampleProfile() {
  const dimensionBase = {
    confidence: 0.8,
    supporting_quotes: [],
  };
  return VentureProfileSchema.parse({
    venture_codename: "VentureX",
    synthetic_description:
      "A synthetic venture building intelligent power distribution for high-density data centers.",
    intended_end_state: {
      scale: "$500M revenue business",
      timeline_years: 5,
      minimum_success_criteria: "Reach material share in priority markets.",
    },
    current_maturity: "pre_concept",
    dimensions: {
      product_solution: {
        ...dimensionBase,
        job_to_be_done: "Safely distribute and meter rack-level power.",
        solution_mechanism: "Intelligent rack power hardware and software.",
        platform_or_pipe: "hybrid",
        core_features: ["metering"],
        substitution_landscape: ["busway"],
      },
      customers: {
        ...dimensionBase,
        segment_type: "B2B-Enterprise",
        buyer: "Data center infrastructure leaders",
        user: "Facilities operators",
        target_sub_segments: ["hyperscale", "colocation"],
        buyer_sophistication: "high",
      },
      transaction: {
        ...dimensionBase,
        model: "unit_sales",
        typical_deal_size_usd: "$100k–$1M",
        margin_profile: "medium",
        revenue_recurrence: "mixed",
      },
      partners: {
        ...dimensionBase,
        distribution_channels: ["integrators"],
        key_suppliers: ["electronics suppliers"],
        regulators_certifications: ["UL", "CE"],
        system_integrators_resellers: ["data center integrators"],
        complementary_product_partners: ["server OEMs"],
      },
      access: {
        ...dimensionBase,
        learn: "Industry specifications",
        reach: "Integrator channels",
        acquire: "Enterprise sales",
        maintain: "Service network",
        access_intensity: "medium",
      },
      geography_regulatory: {
        ...dimensionBase,
        target_geographies: ["North America", "Europe", "Asia"],
        accessible_market_constraints: ["certification"],
        regulatory_regime: "Medium",
        localization_requirements: ["local voltage and plug standards"],
      },
      capital_asset: {
        ...dimensionBase,
        capital_intensity: "high",
        asset_type: "hardware",
        manufacturing_footprint: "Regional manufacturing and supply chain",
        defensibility_model: "scale and channel trust",
        time_to_revenue_years: 3,
      },
    },
    strategic_risks_and_uncertainties: [
      {
        risk: "AI rack density may outpace conventional AC distribution.",
        implies_search_for: "high-density rack power alternatives",
      },
    ],
    gaps_in_input: [],
  });
}

export function sampleReportData(): InvestorReportData {
  const parameters = Array.from({ length: 10 }, (_, index) => ({
    parameter_key: `parameter_${index}`,
    parameter_label: `Parameter ${index + 1}`,
    tier: (index < 3 ? 1 : index < 7 ? 2 : 3) as 1 | 2 | 3,
    description: `Decision parameter ${index + 1}`,
    value_shape: "string" as const,
  }));
  const candidates = [
    { id: "alpha", name: "Alpha Power", score: 4.62, rank: 1 },
    { id: "beta", name: "Beta Grid", score: 4.18, rank: 2 },
    { id: "gamma", name: "Gamma Systems", score: 3.84, rank: 3 },
  ].map((item, index) => ({
    candidate_id: item.id,
    name: item.name,
    product_line: null,
    logo_url: index === 0 ? "https://alpha.example/favicon.ico" : null,
    candidate_type: index === 2 ? "same_problem_different_mechanism" : "direct",
    aggregate_score: item.score,
    rank: item.rank,
    dimension_scores: Object.fromEntries(
      DIMENSION_KEYS.map((dimension, dimensionIndex) => [
        dimension,
        {
          score: Math.max(1, 5 - (dimensionIndex % 3)),
          rationale: `${item.name} has meaningful ${dimension} overlap.`,
          confidence: 0.85,
        },
      ]),
    ),
    stats: { total: 10, verified: 8, inferred: 2, unknown: 0 },
    rationale:
      index === 0
        ? "<script>alert(1)</script> leads the category and overlaps with the highest-weight requirements."
        : `${item.name} matters because its portfolio creates a credible substitution path.`,
    citations:
      index === 0
        ? [
            {
              url: "https://source.example/alpha",
              title: "Source & proof",
              query: "rack power competitor evidence",
            },
          ]
        : [],
  }));
  const weightValues = [0.24, 0.1, 0.08, 0.1, 0.05, 0.18, 0.25] as const;
  const weights = DIMENSION_KEYS.map((dimension, index) => ({
    dimension,
    weight: weightValues[index]!,
    rationale: `${dimension} determines whether competitive overlap changes the venture thesis.`,
  })) satisfies InvestorReportWeight[];

  return {
    venture: {
      id: "venture-1",
      slug: "rack-power",
      title: "Rack Power Venture",
      generated_at: "2026-07-09T00:00:00.000Z",
    },
    profile: sampleProfile(),
    weights,
    candidates,
    parameters,
    cells: candidates.flatMap((candidate) =>
      parameters.map((parameter, index) => ({
        candidate_id: candidate.candidate_id,
        parameter_key: parameter.parameter_key,
        tier: parameter.tier,
        confidence: index === 9 ? ("inferred" as const) : ("verified" as const),
        value:
          index === 4
            ? { disclosed: true, detail: "Regional manufacturing" }
            : `Evidence for ${candidate.name}`,
        citations:
          index === 0
            ? [
                {
                  source_title: "Source & proof",
                  url: "https://source.example/alpha",
                  snippet: "Company evidence",
                  retrieved_at: "2026-07-01",
                },
              ]
            : [],
        reason: null,
        retrieved_at: "2026-07-01",
      })),
    ),
    source_counts: { candidates: 42, parameters: 54 },
  };
}
