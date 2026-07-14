import { z } from "zod";

import type { Parameter, ParameterTier } from "@/types/parameter";

export const ResearchProviderNameSchema = z.enum([
  "exa",
  "brave",
  "bright_data",
  "sec_edgar",
  "gleif",
  "companies_house",
  "perplexity",
  "openrouter",
]);
export type ResearchProviderName = z.infer<typeof ResearchProviderNameSchema>;

export const SourceClassSchema = z.enum([
  "official_registry",
  "official_filing",
  "official_company",
  "official_partner",
  "authorized_distributor",
  "news",
  "industry_analyst",
  "other",
]);
export type SourceClass = z.infer<typeof SourceClassSchema>;

export const EvidenceDispositionSchema = z.enum([
  "direct",
  "inferred",
  "contradictory",
  "rejected",
]);
export type EvidenceDisposition = z.infer<typeof EvidenceDispositionSchema>;

export const ResearchConfidenceSchema = z.enum([
  "verified",
  "inferred",
  "unknown",
]);
export type ResearchConfidence = z.infer<typeof ResearchConfidenceSchema>;

export interface CandidateIdentity {
  candidateId: string;
  name: string;
  legalName?: string | null;
  aliases: string[];
  domains: string[];
  countryCode?: string | null;
  cik?: string | null;
  lei?: string | null;
  companiesHouseNumber?: string | null;
}

export interface SearchRequest {
  query: string;
  count: number;
  dateFrom?: string;
  dateTo?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  language?: string;
  timeoutMs?: number;
}

export interface SearchHit {
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string | null;
  rank: number;
  score?: number | null;
  searchQuery?: string | null;
}

export interface SearchResponse {
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  query: string;
  hits: SearchHit[];
  latencyMs: number;
  costUsd: number;
}

export interface ContentRequest {
  url: string;
  objective?: string;
  maxCharacters: number;
  timeoutMs?: number;
}

export interface ContentResponse {
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  url: string;
  title: string;
  content: string;
  publishedAt?: string | null;
  contentType?: string | null;
  latencyMs: number;
  costUsd: number;
}

export interface OfficialLookupRequest {
  candidate: CandidateIdentity;
  parameterKey: string;
  asOf: string;
  timeoutMs?: number;
}

export interface OfficialFact {
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  parameterKey: string;
  value: unknown;
  url: string;
  title: string;
  excerpt: string;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  sourceClass: SourceClass;
  costUsd: number;
  latencyMs: number;
}

export interface SearchProvider {
  readonly name: ResearchProviderName;
  search(request: SearchRequest): Promise<SearchResponse>;
}

export interface ContentProvider {
  readonly name: ResearchProviderName;
  fetch(request: ContentRequest): Promise<ContentResponse>;
}

export interface OfficialDataProvider {
  readonly name: ResearchProviderName;
  supports(parameterKey: string, candidate: CandidateIdentity): boolean;
  lookup(request: OfficialLookupRequest): Promise<OfficialFact[]>;
}

export interface DeepResearchRequest {
  candidate: CandidateIdentity;
  parameter: Parameter;
  proofRule: string;
  asOf: string;
  maxCostUsd: number;
  priorReason?: string | null;
  productHint?: string;
  timeoutMs?: number;
}

export interface DeepResearchResponse {
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  value: unknown | null;
  confidence: ResearchConfidence;
  reason: string | null;
  evidence: ResearchEvidence[];
  latencyMs: number;
  costUsd: number;
}

export interface DeepResearchProvider {
  readonly name: ResearchProviderName;
  readonly enabled: boolean;
  research(request: DeepResearchRequest): Promise<DeepResearchResponse>;
}

export interface FreshnessPolicy {
  maxAgeDays?: number;
  dateWindow?: "rolling_12_months";
  publicationDateRequired?: boolean;
  requiredEvidenceDateKind?: "published" | "effective";
}

export interface PolicyValidationResult {
  pass: boolean;
  reason: string;
}

export interface ResearchPolicy {
  parameterKey: string;
  officialProviders: ResearchProviderName[];
  sourcePreference: SourceClass[];
  queryTemplates: string[];
  freshness?: FreshnessPolicy;
  proofRule: string;
  inference: "forbidden" | "allowed" | "expected";
  minimumDirectSources: number;
  maximumAttempts: number;
  maximumSearches: number;
  maximumFetchedPages: number;
  maximumCostUsd: number;
  validateValue(value: unknown): PolicyValidationResult;
}

export interface ResearchEvidence {
  id?: string;
  provider: ResearchProviderName;
  providerRequestId?: string | null;
  url: string;
  canonicalUrl: string;
  title: string;
  sourceDomain: string;
  sourceClass: SourceClass;
  excerpt: string;
  fullContent?: string;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  retrievedAt: string;
  searchQuery?: string | null;
  resultRank?: number | null;
  contentHash?: string | null;
  candidateMatch?: boolean | null;
  disposition: EvidenceDisposition;
  supportedValuePaths: string[];
  verifierReason?: string | null;
}

export const ProposedCellSchema = z.object({
  parameter_key: z.string().min(1).max(80),
  value: z.unknown().nullable(),
  proposed_confidence: ResearchConfidenceSchema,
  reason: z.string().max(2000).nullable(),
  evidence_indexes: z.array(z.number().int().nonnegative()).max(10),
});
export type ProposedCell = z.infer<typeof ProposedCellSchema>;

export const VerificationOutcomeSchema = z.object({
  supports_exact_value: z.boolean(),
  candidate_match: z.boolean(),
  product_scope_match: z.boolean(),
  freshness_pass: z.boolean(),
  source_allowed: z.boolean(),
  contradiction_detected: z.boolean(),
  unsupported_value_paths: z.array(z.string().max(200)).max(30),
  direct_evidence_indexes: z.array(z.number().int().nonnegative()).max(10),
  inferred_evidence_indexes: z.array(z.number().int().nonnegative()).max(10),
  evidence_dates: z
    .array(
      z.object({
        evidence_index: z.number().int().nonnegative(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        date_kind: z.enum(["published", "effective"]),
      }),
    )
    .max(10),
  reason: z.string().min(1).max(2000),
});
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

export interface ResearchCellOutcome {
  candidateId: string;
  parameterKey: string;
  tier: ParameterTier;
  value: unknown | null;
  proposedConfidence: ResearchConfidence;
  finalConfidence: ResearchConfidence;
  reason: string | null;
  verification: VerificationOutcome | null;
  evidence: ResearchEvidence[];
  attempts: ProviderCallRecord[];
  costUsd: number;
  latencyMs: number;
}

export interface ProviderCallRecord {
  provider: ResearchProviderName;
  operation: string;
  query?: string | null;
  requestMetadata: Record<string, unknown>;
  responseMetadata: Record<string, unknown>;
  resultCount?: number | null;
  costUsd: number;
  latencyMs: number;
  error?: string | null;
}

export interface ResearchRunBudget {
  softCapUsd: number;
  hardCapUsd: number;
  spentUsd: number;
}

export interface ResearchCellContext {
  runId: string;
  ventureId: string;
  candidate: CandidateIdentity;
  parameter: Parameter;
  policy: ResearchPolicy;
  asOf: string;
  retrievedAt: string;
  budget: ResearchRunBudget;
}
