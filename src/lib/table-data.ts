import type { InsForgeClient } from "@/lib/insforge/server";
import {
  type ComparisonCandidate,
  type ComparisonCell,
  type ComparisonCitation,
  type ComparisonTableData,
  parameterToComparison,
  slugify,
  tierToNumber,
} from "@/lib/table-viewer";
import { CellConfidenceSchema, CellTierSchema } from "@/types/cell";
import { ParameterSchema, type Parameter } from "@/types/parameter";

interface VentureRow {
  id: string;
  codename: string | null;
  user_provided_description: string;
  created_at: string;
}

interface CandidateRow {
  id: string;
  name: string;
  generation_run_id: string;
  created_at: string;
}

interface ParameterRunRow {
  full_parameter_schema: unknown;
  created_at: string;
}

interface CellRow {
  candidate_id: string;
  parameter_key: string;
  tier: string;
  value: unknown;
  citation: unknown;
  confidence: string;
  reason: string | null;
  created_at: string;
}

export async function loadComparisonTableData(
  insforge: InsForgeClient,
  ventureId: string,
): Promise<{ data: ComparisonTableData | null; error: string | null }> {
  const { data: ventureRaw, error: ventureError } = await insforge.database
    .from("ventures")
    .select("id, codename, user_provided_description, created_at")
    .eq("id", ventureId)
    .maybeSingle();

  if (ventureError) return { data: null, error: ventureError.message };
  if (!ventureRaw) return { data: null, error: null };

  const venture = ventureRaw as unknown as VentureRow;

  const { data: runRaw, error: runError } = await insforge.database
    .from("parameter_generation_runs")
    .select("full_parameter_schema, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) return { data: null, error: runError.message };

  const parameterRun = (runRaw as unknown as ParameterRunRow | null) ?? null;
  const parameters = parseParameterSchema(parameterRun?.full_parameter_schema);

  const { data: candidatesRaw, error: candidatesError } = await insforge.database
    .from("candidate_companies")
    .select("id, name, generation_run_id, created_at")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: true });

  if (candidatesError) return { data: null, error: candidatesError.message };

  const allCandidates = ((candidatesRaw as CandidateRow[] | null) ?? []);
  const latestRunId = allCandidates.at(-1)?.generation_run_id ?? null;
  const candidateRows = latestRunId
    ? allCandidates.filter((candidate) => candidate.generation_run_id === latestRunId)
    : [];
  const candidateIds = candidateRows.map((candidate) => candidate.id);

  const cells: ComparisonCell[] = [];
  if (candidateIds.length > 0) {
    // InsForge / PostgREST hard-caps responses at 1000 rows server-side
    // (verified 2026-05-21: Range header ignored, `content-range: 0-999/*`
    // returned regardless of `Range: 0-9999` request). With 42 candidates ×
    // ~55 cells = ~2300 rows the unsorted tail gets silently dropped, which
    // surfaced as "candidates with 0 cells" in the comparison table even
    // though every candidate had a full row of cells in Postgres. We page
    // explicitly to defeat this.
    const PAGE = 1000;
    let from = 0;
    const cellsRawAll: CellRow[] = [];
    while (true) {
      const { data: cellsRaw, error: cellsError } = await insforge.database
        .from("cells")
        .select(
          "candidate_id, parameter_key, tier, value, citation, confidence, reason, created_at",
        )
        .in("candidate_id", candidateIds)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (cellsError) return { data: null, error: cellsError.message };
      const rows = (cellsRaw as CellRow[] | null) ?? [];
      cellsRawAll.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    for (const row of cellsRawAll) {
      const parsedTier = CellTierSchema.safeParse(row.tier);
      const parsedConfidence = CellConfidenceSchema.safeParse(row.confidence);
      if (!parsedTier.success || !parsedConfidence.success) continue;
      const citation = normalizeCitation(row.citation);
      cells.push({
        candidate_id: row.candidate_id,
        parameter_key: row.parameter_key,
        tier: tierToNumber(parsedTier.data),
        confidence: parsedConfidence.data,
        value: row.value,
        citations: citation ? [citation] : [],
        reason: row.reason,
        retrieved_at: citation?.retrieved_at ?? row.created_at ?? null,
      });
    }
  }

  const cellsByCandidate = new Map<string, ComparisonCell[]>();
  for (const cell of cells) {
    const existing = cellsByCandidate.get(cell.candidate_id) ?? [];
    existing.push(cell);
    cellsByCandidate.set(cell.candidate_id, existing);
  }

  const candidates: ComparisonCandidate[] = candidateRows.map((candidate) => {
    const candidateCells = cellsByCandidate.get(candidate.id) ?? [];
    return {
      candidate_id: candidate.id,
      name: candidate.name,
      product_line: null,
      logo_url: null,
      stats: {
        total: candidateCells.length,
        verified: candidateCells.filter((cell) => cell.confidence === "verified").length,
        inferred: candidateCells.filter((cell) => cell.confidence === "inferred").length,
        unknown: candidateCells.filter((cell) => cell.confidence === "unknown").length,
      },
    };
  });

  const title = venture.codename || firstLine(venture.user_provided_description) || "Venture";
  return {
    data: {
      venture: {
        id: venture.id,
        slug: slugify(title),
        title,
        generated_at: parameterRun?.created_at ?? venture.created_at,
      },
      candidates,
      parameters: parameters.map(parameterToComparison),
      cells,
    },
    error: null,
  };
}

function parseParameterSchema(input: unknown): Parameter[] {
  if (!Array.isArray(input)) return [];
  const parameters: Parameter[] = [];
  for (const entry of input) {
    const parsed = ParameterSchema.safeParse(entry);
    if (parsed.success) parameters.push(parsed.data);
  }
  return parameters;
}

function normalizeCitation(input: unknown): ComparisonCitation | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const url = typeof raw.url === "string" ? raw.url : null;
  if (!url) return null;
  const sourceTitle =
    typeof raw.source_title === "string"
      ? raw.source_title
      : typeof raw.title === "string"
        ? raw.title
        : url;
  return {
    source_title: sourceTitle,
    url,
    snippet: typeof raw.snippet === "string" ? raw.snippet : "",
    retrieved_at: typeof raw.retrieved_at === "string" ? raw.retrieved_at : "",
  };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}
