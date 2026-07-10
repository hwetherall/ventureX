import type { InsForgeClient } from "@/lib/insforge/server";
import { loadComparisonTableData } from "@/lib/table-data";
import type {
  ComparisonCandidate,
  ComparisonParameter,
  ComparisonTableData,
} from "@/lib/table-viewer";
import { CitationSchema } from "@/types/candidate";
import {
  DIMENSION_KEYS,
  VentureProfileSchema,
  type Dimension,
  type VentureProfile,
} from "@/types/venture-profile";

/**
 * Step 2 deliberately ships as a focused design proof: the three highest
 * ranked companies and ten parameters. The production expansion is a data
 * volume change (10 companies + the complete schema), not a report redesign.
 */
export const REPORT_CANDIDATE_LIMIT = 3;
export const REPORT_PARAMETER_LIMIT = 10;

export interface InvestorReportWeight {
  dimension: Dimension;
  weight: number;
  rationale: string;
}

export interface InvestorReportCitation {
  url: string;
  title: string;
  query: string;
}

export interface InvestorReportCandidate extends ComparisonCandidate {
  rationale: string;
  citations: InvestorReportCitation[];
}

export interface InvestorReportData {
  venture: ComparisonTableData["venture"];
  profile: VentureProfile;
  weights: InvestorReportWeight[];
  candidates: InvestorReportCandidate[];
  parameters: ComparisonParameter[];
  cells: ComparisonTableData["cells"];
  source_counts: {
    candidates: number;
    parameters: number;
  };
}

interface ProfileVersionRow {
  profile_json: unknown;
}

interface DimensionWeightRow {
  dimension: string;
  weight: number | string;
  rationale: string | null;
  created_at: string;
}

export interface CandidateDetailRow {
  id: string;
  rationale: string;
  citations: unknown;
}

export async function loadInvestorReportData(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{ data: InvestorReportData | null; error: string | null }> {
  const tableResult = await loadComparisonTableData(insforge, ventureId);
  if (tableResult.error || !tableResult.data) {
    return { data: null, error: tableResult.error };
  }

  const table = tableResult.data;
  const candidateIds = table.candidates.map(
    (candidate) => candidate.candidate_id,
  );

  const [profileResult, weightsResult, detailsResult] = await Promise.all([
    insforge.database
      .from("profile_versions")
      .select("profile_json")
      .eq("venture_id", ventureId)
      .in("source", ["human_refined", "llm_extracted"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    insforge.database
      .from("dimension_weights")
      .select("dimension, weight, rationale, created_at")
      .eq("venture_id", ventureId)
      .order("created_at", { ascending: false }),
    candidateIds.length > 0
      ? insforge.database
          .from("candidate_companies")
          .select("id, rationale, citations")
          .in("id", candidateIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profileResult.error) {
    return { data: null, error: profileResult.error.message };
  }
  if (weightsResult.error) {
    return { data: null, error: weightsResult.error.message };
  }
  if (detailsResult.error) {
    return { data: null, error: detailsResult.error.message };
  }

  const profileRow = profileResult.data as ProfileVersionRow | null;
  const parsedProfile = VentureProfileSchema.safeParse(
    profileRow?.profile_json,
  );
  if (!parsedProfile.success) {
    return {
      data: null,
      error:
        "The latest venture profile is missing or invalid; the report cannot be assembled.",
    };
  }

  const weights = latestWeights(
    (weightsResult.data as DimensionWeightRow[] | null) ?? [],
  );
  if (weights.length !== DIMENSION_KEYS.length) {
    return {
      data: null,
      error:
        "The venture does not have a complete seven-dimension weighting set.",
    };
  }

  const detailById = new Map(
    ((detailsResult.data as CandidateDetailRow[] | null) ?? []).map((row) => [
      row.id,
      row,
    ]),
  );

  return {
    data: prepareInvestorReportData(
      table,
      parsedProfile.data,
      weights,
      detailById,
    ),
    error: null,
  };
}

export function prepareInvestorReportData(
  table: ComparisonTableData,
  profile: VentureProfile,
  weights: InvestorReportWeight[],
  detailById: Map<string, CandidateDetailRow>,
): InvestorReportData {
  const candidates = selectReportCandidates(table.candidates).map(
    (candidate) => {
      const detail = detailById.get(candidate.candidate_id);
      return {
        ...candidate,
        rationale:
          detail?.rationale?.trim() ||
          "This company is included because its researched operating profile overlaps with the venture's priority dimensions.",
        citations: normalizeCandidateCitations(detail?.citations),
      };
    },
  );
  const candidateIds = new Set(
    candidates.map((candidate) => candidate.candidate_id),
  );
  const parameters = selectReportParameters(table.parameters);
  const parameterKeys = new Set(
    parameters.map((parameter) => parameter.parameter_key),
  );

  return {
    venture: table.venture,
    profile,
    weights,
    candidates,
    parameters,
    cells: table.cells.filter(
      (cell) =>
        candidateIds.has(cell.candidate_id) &&
        parameterKeys.has(cell.parameter_key),
    ),
    source_counts: {
      candidates: table.candidates.length,
      parameters: table.parameters.length,
    },
  };
}

export function selectReportCandidates(
  candidates: ComparisonCandidate[],
  limit = REPORT_CANDIDATE_LIMIT,
): ComparisonCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      const aRank = a.rank ?? Number.POSITIVE_INFINITY;
      const bRank = b.rank ?? Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      const aScore = a.aggregate_score ?? Number.NEGATIVE_INFINITY;
      const bScore = b.aggregate_score ?? Number.NEGATIVE_INFINITY;
      if (aScore !== bScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/**
 * Selects a mixed-difficulty ten-parameter appendix:
 *   - 3 Tier 1 / foundational
 *   - 4 Tier 2 / framework
 *   - 3 Tier 3 / venture-specific
 *
 * Items are sampled evenly from the beginning through the end of each tier,
 * avoiding the misleading "first ten" shortcut and keeping the selection
 * stable when the schema does not change.
 */
export function selectReportParameters(
  parameters: ComparisonParameter[],
  limit = REPORT_PARAMETER_LIMIT,
): ComparisonParameter[] {
  if (limit <= 0) return [];

  const requested = [
    { tier: 1 as const, count: Math.min(3, limit) },
    { tier: 2 as const, count: Math.min(4, Math.max(0, limit - 3)) },
    { tier: 3 as const, count: Math.min(3, Math.max(0, limit - 7)) },
  ];
  const selected: ComparisonParameter[] = [];

  for (const { tier, count } of requested) {
    selected.push(
      ...takeEvenly(
        parameters.filter((parameter) => parameter.tier === tier),
        count,
      ),
    );
  }

  if (selected.length < limit) {
    const used = new Set(selected.map((parameter) => parameter.parameter_key));
    selected.push(
      ...parameters
        .filter((parameter) => !used.has(parameter.parameter_key))
        .slice(0, limit - selected.length),
    );
  }

  return selected.slice(0, limit);
}

function takeEvenly<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[Math.floor((items.length - 1) / 2)]!];

  const indexes = new Set<number>();
  for (let index = 0; index < count; index++) {
    indexes.add(Math.round((index * (items.length - 1)) / (count - 1)));
  }
  return [...indexes].map((index) => items[index]!);
}

function latestWeights(rows: DimensionWeightRow[]): InvestorReportWeight[] {
  const latest = new Map<Dimension, InvestorReportWeight>();
  for (const row of rows) {
    if (!DIMENSION_KEYS.includes(row.dimension as Dimension)) continue;
    const dimension = row.dimension as Dimension;
    if (latest.has(dimension)) continue;
    const weight =
      typeof row.weight === "number" ? row.weight : Number(row.weight);
    if (!Number.isFinite(weight)) continue;
    latest.set(dimension, {
      dimension,
      weight,
      rationale: row.rationale?.trim() || "No rationale was recorded.",
    });
  }
  return DIMENSION_KEYS.flatMap((dimension) => {
    const weight = latest.get(dimension);
    return weight ? [weight] : [];
  });
}

function normalizeCandidateCitations(value: unknown): InvestorReportCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = CitationSchema.safeParse(entry);
    if (!parsed.success) return [];
    return [parsed.data];
  });
}
