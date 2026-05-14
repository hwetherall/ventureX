import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ────────────────────────────────────────────────────────────────────────

const SupportingQuoteSchema = z.object({
  quote: z.string().min(1),
  source: z.string().min(1),
});

const ConfidenceSchema = z.number().min(0).max(1);

// Enum policy: when CLAUDE.md Section 8 lists a closed enum AND the example
// output stays inside that enum, we enforce it. When the spec says "pick top
// 1-2" or the example uses free-form (e.g., "scale + brand (data center
// operator trust)" for defensibility_model), we accept any non-empty string
// so the LLM isn't forced to truncate context.

// ────────────────────────────────────────────────────────────────────────
// Dimensions (nested under `dimensions` per eng review D1, 2026-05-14)
// ────────────────────────────────────────────────────────────────────────

export const ProductSolutionSchema = z.object({
  job_to_be_done: z.string().min(1),
  solution_mechanism: z.string().min(1),
  platform_or_pipe: z.enum(["pipe", "platform", "hybrid"]),
  core_features: z.array(z.string().min(1)).min(1),
  // The substitution_landscape is load-bearing for Phase 3 candidate generation.
  // We require at least 1 entry; the prompt asks for 3-6. Zero entries here
  // would silently break downstream.
  substitution_landscape: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const CustomersSchema = z.object({
  segment_type: z.enum(["B2C", "B2B-SME", "B2B-Enterprise", "B2G", "mixed"]),
  buyer: z.string().min(1),
  user: z.string().min(1),
  target_sub_segments: z.array(z.string().min(1)),
  buyer_sophistication: z.enum(["low", "medium", "high"]),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const TransactionSchema = z.object({
  model: z.enum([
    "unit_sales",
    "subscription",
    "licensing",
    "commission",
    "fee_for_service",
    "advertising",
    "rental",
    "hybrid",
  ]),
  typical_deal_size_usd: z.string().min(1),
  margin_profile: z.enum(["low", "medium", "high"]),
  revenue_recurrence: z.enum(["one_time", "recurring", "mixed"]),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const PartnersSchema = z.object({
  distribution_channels: z.array(z.string().min(1)),
  key_suppliers: z.array(z.string().min(1)),
  regulators_certifications: z.array(z.string().min(1)),
  system_integrators_resellers: z.array(z.string().min(1)),
  complementary_product_partners: z.array(z.string().min(1)),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const AccessSchema = z.object({
  learn: z.string().min(1),
  reach: z.string().min(1),
  acquire: z.string().min(1),
  maintain: z.string().min(1),
  access_intensity: z.enum(["low", "medium", "high"]),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const GeographyRegulatorySchema = z.object({
  target_geographies: z.array(z.string().min(1)),
  accessible_market_constraints: z.array(z.string().min(1)),
  regulatory_regime: z.enum(["Light", "Medium", "Heavy"]),
  localization_requirements: z.string().min(1),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

export const CapitalAssetSchema = z.object({
  capital_intensity: z.enum(["low", "medium", "high"]),
  asset_type: z.enum(["hardware", "software", "services", "hybrid"]),
  // Free-form: example uses "Likely a mix of owned electrical-equipment
  // manufacturing capacity (leverageable from parent) and contract
  // manufacturing for IT-specific components".
  manufacturing_footprint: z.string().min(1),
  // Free-form: example uses "scale + brand (data center operator trust)".
  defensibility_model: z.string().min(1),
  time_to_revenue_years: z.number().min(0).max(20),
  confidence: ConfidenceSchema,
  supporting_quotes: z.array(SupportingQuoteSchema).max(5),
  notes: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// Top-level structures
// ────────────────────────────────────────────────────────────────────────

export const IntendedEndStateSchema = z.object({
  scale: z.string().min(1),
  timeline_years: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(5),
    z.literal(10),
  ]),
  minimum_success_criteria: z.string().min(1),
});

export const StrategicRiskSchema = z.object({
  risk: z.string().min(1),
  // The implies_search_for field is the second load-bearing field
  // (CLAUDE.md Section 8): Phase 3 candidate generation reads it directly.
  // An empty implies_search_for means the prompt is broken.
  implies_search_for: z.string().min(1),
});

export const CurrentMaturitySchema = z.enum([
  "pre_concept",
  "concept",
  "early_prototype",
  "pilot",
  "early_revenue",
  "scaling",
]);

// ────────────────────────────────────────────────────────────────────────
// Full profile (D1: nested `dimensions`, top-level `venture_codename`)
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * The canonical Zod schema for a Stage 1 / HITL / Stage 2 venture profile.
 * Stage 1 extraction validates the LLM response against this; HITL writes
 * never persist a profile that fails this; Stage 2 reads only this shape.
 */
export const VentureProfileSchema = z.object({
  venture_codename: z.literal("VentureX"),
  synthetic_description: z.string().min(1),
  intended_end_state: IntendedEndStateSchema,
  current_maturity: CurrentMaturitySchema,
  dimensions: z.object({
    product_solution: ProductSolutionSchema,
    customers: CustomersSchema,
    transaction: TransactionSchema,
    partners: PartnersSchema,
    access: AccessSchema,
    geography_regulatory: GeographyRegulatorySchema,
    capital_asset: CapitalAssetSchema,
  }),
  strategic_risks_and_uncertainties: z
    .array(StrategicRiskSchema)
    .min(1)
    .max(10),
  gaps_in_input: z.array(z.string().min(1)).max(10),
});

export type VentureProfile = z.infer<typeof VentureProfileSchema>;
export type SupportingQuote = z.infer<typeof SupportingQuoteSchema>;
export type StrategicRisk = z.infer<typeof StrategicRiskSchema>;
export type IntendedEndState = z.infer<typeof IntendedEndStateSchema>;
export type CurrentMaturity = z.infer<typeof CurrentMaturitySchema>;
export type Dimension = keyof VentureProfile["dimensions"];

export const DIMENSION_KEYS = [
  "product_solution",
  "customers",
  "transaction",
  "partners",
  "access",
  "geography_regulatory",
  "capital_asset",
] as const satisfies readonly Dimension[];
