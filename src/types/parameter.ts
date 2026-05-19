import { z } from "zod";

import { DIMENSION_KEYS } from "./venture-profile";

export const ParameterTierSchema = z.enum([
  "universal",
  "framework",
  "dynamic",
]);

export const ParameterDimensionSchema = z.enum([...DIMENSION_KEYS, "meta"]);

export const DynamicParameterDimensionSchema = z.enum(DIMENSION_KEYS);

export const ParameterValueTypeSchema = z.enum([
  "enum",
  "number",
  "short_string",
  "list",
  "prose",
  "url",
  "object",
]);

export const CellBudgetSchema = z.enum(["atom", "sentence", "paragraph"]);

export const SourcePreferenceSchema = z.enum([
  "official_company",
  "official_third_party",
  "news",
  "industry_analyst",
  "inferred",
]);

const StableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);

export const ParameterSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1).max(140),
  tier: ParameterTierSchema,
  innovera_dimension: ParameterDimensionSchema,
  value_type: ParameterValueTypeSchema,
  value_schema: z.record(z.unknown()).optional(),
  cell_budget: CellBudgetSchema,
  citation_required: z.boolean(),
  source_preference: z.array(SourcePreferenceSchema).min(1).max(5),
  prompt_hint: z.string().min(1).max(1200),
  source_field: z.string().min(1).max(300).optional(),
});

export const DynamicParameterSchema = ParameterSchema.extend({
  tier: z.literal("dynamic"),
  innovera_dimension: DynamicParameterDimensionSchema,
  citation_required: z.literal(true),
  source_field: z.string().min(1).max(300),
});

export const Stage4ParameterBuilderOutputSchema = z.object({
  venture_id: z.string().min(1),
  generated_at: z.string().min(1).max(80),
  dynamic_parameters: z.array(DynamicParameterSchema).min(10).max(20),
  generation_notes: z.string().max(800).optional(),
});

export type ParameterTier = z.infer<typeof ParameterTierSchema>;
export type ParameterDimension = z.infer<typeof ParameterDimensionSchema>;
export type ParameterValueType = z.infer<typeof ParameterValueTypeSchema>;
export type CellBudget = z.infer<typeof CellBudgetSchema>;
export type SourcePreference = z.infer<typeof SourcePreferenceSchema>;
export type Parameter = z.infer<typeof ParameterSchema>;
export type DynamicParameter = z.infer<typeof DynamicParameterSchema>;
export type Stage4ParameterBuilderOutput = z.infer<
  typeof Stage4ParameterBuilderOutputSchema
>;
