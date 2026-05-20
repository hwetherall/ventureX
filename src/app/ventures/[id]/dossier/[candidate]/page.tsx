import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { ParameterSchema, type Parameter } from "@/types/parameter";
import type { CellConfidence, CellRow, CellTier } from "@/types/cell";

/**
 * Threshold for the "thin-evidence" warning (M15-F5). When the share of
 * citation-required cells that actually carry a citation falls below this,
 * the dossier surfaces a yellow badge explaining the evidence gap so the
 * consultant doesn't read "31% unknown" as "the system is broken" when the
 * actual cause is a thin evidence base for this particular candidate.
 *
 * 40% chosen because the Schneider baseline run on 2026-05-19 cited ~52% of
 * non-unknown citation-required cells; sub-40% indicates the candidate's
 * evidence shape is unusual (less-public company, light press coverage,
 * non-English-dominant operations, etc.).
 */
const THIN_EVIDENCE_THRESHOLD = 0.4;

interface CellRecord {
  id: string;
  parameter_key: string;
  tier: CellTier;
  value: unknown;
  citation: unknown;
  confidence: CellConfidence;
  reason: string | null;
  created_at: string;
}

interface VentureRow {
  id: string;
  status: string;
  user_provided_description: string;
}

interface CandidateRow {
  id: string;
  name: string;
  rationale: string;
}

const TIER_ORDER: CellTier[] = ["universal", "framework", "dynamic"];

const TIER_LABELS: Record<CellTier, string> = {
  universal: "Tier 1 — Universal",
  framework: "Tier 2 — Framework",
  dynamic: "Tier 3 — Dynamic",
};

const TIER_SUBTITLES: Record<CellTier, string> = {
  universal:
    "Stable identity facts (training-data only). Citations optional by design.",
  framework:
    "7-dimension framework snapshot, grounded in the candidate's M13 citations.",
  dynamic:
    "Venture-specific differentiators. Per-cell Exa neural search + Sonnet extraction — the load-bearing tier.",
};

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string; candidate: string }>;
}) {
  await requireUser();
  const { id: ventureId, candidate: candidateId } = await params;
  const insforge = await createAuthedServerClient();

  const { data: ventureRaw } = await insforge.database
    .from("ventures")
    .select("id, status, user_provided_description")
    .eq("id", ventureId)
    .maybeSingle();
  if (!ventureRaw) notFound();
  const venture = ventureRaw as unknown as VentureRow;

  const { data: candidateRaw } = await insforge.database
    .from("candidate_companies")
    .select("id, name, rationale, venture_id")
    .eq("id", candidateId)
    .eq("venture_id", ventureId)
    .maybeSingle();
  if (!candidateRaw) notFound();
  const candidate = candidateRaw as unknown as CandidateRow;

  const { data: cellsRaw } = await insforge.database
    .from("cells")
    .select(
      "id, parameter_key, tier, value, citation, confidence, reason, created_at",
    )
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });
  const cells = (cellsRaw as CellRecord[] | null) ?? [];

  // Parameter schema lets us render `name` (human-readable) alongside the
  // raw `parameter_key`.
  const { data: paramRunRaw } = await insforge.database
    .from("parameter_generation_runs")
    .select("full_parameter_schema")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const paramByKey = buildParamByKey(paramRunRaw);

  const cellsByTier: Record<CellTier, CellRecord[]> = {
    universal: [],
    framework: [],
    dynamic: [],
  };
  for (const c of cells) {
    cellsByTier[c.tier].push(c);
  }

  const counts = countByConfidence(cells);
  const evidenceDensity = computeEvidenceDensity(cells, paramByKey);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {candidate.name} dossier
        </h1>
        <Link
          href={`/ventures/${ventureId}/candidates`}
          className="text-xs underline underline-offset-4 text-muted-foreground"
        >
          ← Candidates
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-1 font-medium">
          {cells.length} cells
        </span>
        <span className="rounded bg-muted px-2 py-1 font-medium text-[color:var(--color-accent)]">
          {counts.verified} verified
        </span>
        <span className="rounded bg-muted px-2 py-1 font-medium text-muted-foreground">
          {counts.inferred} inferred
        </span>
        <span
          className={
            counts.unknown > 0
              ? "rounded bg-[color:var(--color-warning-bg)] px-2 py-1 font-medium text-[color:var(--color-warning-fg)]"
              : "rounded bg-muted px-2 py-1 font-medium text-muted-foreground"
          }
        >
          {counts.unknown} unknown
        </span>
        <span className="rounded bg-muted px-2 py-1 font-mono">
          venture {ventureId.slice(0, 8)}
        </span>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Read-only verification view. Click any citation URL to verify the
        source in &lt;5 seconds. Cells flagged{" "}
        <span className="rounded bg-[color:var(--color-warning-bg)] px-1 py-0.5 text-[color:var(--color-warning-fg)]">
          unknown
        </span>{" "}
        are honest gaps — the orchestrator could not ground the fact in fresh
        evidence after a broadening retry.
      </p>

      {evidenceDensity.showBadge && (
        <section className="mt-6 rounded-md border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] p-4 text-sm text-[color:var(--color-warning-fg)]">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            Thin evidence base for this candidate
          </h2>
          <p className="mt-2">
            Only {Math.round(evidenceDensity.density * 100)}% of
            citation-required cells could be grounded in a public source. The
            unknown count below may reflect a thin evidence base for this
            candidate (less-public company, light press coverage, non-English
            sources) rather than absence of the underlying facts. Verify
            cited cells normally; treat unknowns as research opportunities
            rather than dossier defects.
          </p>
        </section>
      )}

      {cells.length === 0 && (
        <section className="mt-8 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No cells researched yet for this candidate. Return to the candidates
          page and click "Research dossier."
        </section>
      )}

      {TIER_ORDER.map((tier) => (
        <TierSection
          key={tier}
          tier={tier}
          cells={cellsByTier[tier]}
          paramByKey={paramByKey}
        />
      ))}
    </main>
  );
}

function TierSection({
  tier,
  cells,
  paramByKey,
}: {
  tier: CellTier;
  cells: CellRecord[];
  paramByKey: Map<string, Parameter>;
}) {
  if (cells.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {TIER_LABELS[tier]}
        </h2>
        <span className="text-xs text-muted-foreground">
          {cells.length} cells
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{TIER_SUBTITLES[tier]}</p>

      <ul className="mt-5 space-y-3">
        {cells.map((cell) => (
          <CellCard
            key={cell.id}
            cell={cell}
            param={paramByKey.get(cell.parameter_key) ?? null}
            tier={tier}
          />
        ))}
      </ul>
    </section>
  );
}

function CellCard({
  cell,
  param,
  tier,
}: {
  cell: CellRecord;
  param: Parameter | null;
  tier: CellTier;
}) {
  // Tier 3 cells get the load-bearing 2px indigo left rule (per
  // DESIGN.md §11 entry, 2026-05-19) — these are the venture-specific
  // differentiators that justify M15's existence.
  const cardClasses =
    tier === "dynamic"
      ? "rounded-r-md border border-border border-l-2 border-l-[color:var(--color-accent)] bg-surface-elevated p-4 text-sm"
      : "rounded-md border border-border bg-surface p-4 text-sm";

  const displayName = param?.name ?? cell.parameter_key;

  return (
    <li className={cardClasses}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-foreground">{displayName}</h3>
        <ConfidenceBadge confidence={cell.confidence} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {cell.parameter_key}
      </p>

      <div className="mt-3 text-sm text-foreground/90">
        <CellValueRender value={cell.value} />
      </div>

      {cell.citation ? (
        <CitationBlock citation={cell.citation} />
      ) : cell.confidence === "unknown" ? (
        <p className="mt-3 border-t border-border pt-2 text-xs text-[color:var(--color-warning-fg)]">
          {cell.reason ?? "no_evidence_found"}
        </p>
      ) : tier === "universal" ? (
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          Training-data value — no citation required for Tier 1 identity facts.
        </p>
      ) : null}
    </li>
  );
}

function ConfidenceBadge({ confidence }: { confidence: CellConfidence }) {
  if (confidence === "verified") {
    return (
      <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-accent)]">
        verified
      </span>
    );
  }
  if (confidence === "inferred") {
    return (
      <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        inferred
      </span>
    );
  }
  return (
    <span className="rounded bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-warning-fg)]">
      unknown
    </span>
  );
}

function CellValueRender({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">no value</span>;
  }
  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <p className="font-mono">{String(value)}</p>;
  }
  // Objects / arrays — render as JSON, monospaced.
  return (
    <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface CitationDisplayShape {
  url: string;
  title: string;
  snippet: string;
  retrieved_at: string;
}

function CitationBlock({ citation }: { citation: unknown }) {
  const c = citation as Partial<CitationDisplayShape> | null;
  if (!c || typeof c.url !== "string") return null;

  const snippetPreview = (() => {
    const snippet = typeof c.snippet === "string" ? c.snippet : "";
    if (snippet.length <= 120) return { preview: snippet, full: null };
    return { preview: snippet.slice(0, 120) + "…", full: snippet };
  })();

  return (
    <div className="mt-3 border-t border-border pt-3 text-xs">
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-[color:var(--color-accent)] underline underline-offset-2 hover:text-[color:var(--color-accent-hover)]"
      >
        {c.title || c.url}
      </a>
      {snippetPreview.preview && (
        <details className="mt-1 text-muted-foreground">
          <summary className="cursor-pointer">
            {snippetPreview.preview}
          </summary>
          {snippetPreview.full && (
            <p className="mt-2 whitespace-pre-wrap">{snippetPreview.full}</p>
          )}
        </details>
      )}
      {typeof c.retrieved_at === "string" && (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          retrieved {c.retrieved_at}
        </p>
      )}
    </div>
  );
}

function buildParamByKey(paramRunRaw: unknown): Map<string, Parameter> {
  const map = new Map<string, Parameter>();
  if (!paramRunRaw) return map;
  const rawSchema = (paramRunRaw as { full_parameter_schema: unknown })
    .full_parameter_schema;
  if (!Array.isArray(rawSchema)) return map;
  for (const entry of rawSchema) {
    const ok = ParameterSchema.safeParse(entry);
    if (ok.success) {
      map.set(ok.data.id, ok.data);
    }
  }
  return map;
}

function countByConfidence(cells: Pick<CellRow, "confidence">[]): {
  verified: number;
  inferred: number;
  unknown: number;
} {
  const out = { verified: 0, inferred: 0, unknown: 0 };
  for (const c of cells) {
    out[c.confidence] += 1;
  }
  return out;
}

/**
 * @internal Exported for testing.
 *
 * Compute the citation density across cells whose parameter requires a
 * citation. Density = cells-with-citation / cells-where-citation-required
 * (verified/inferred only — `unknown` cells legitimately have no citation).
 *
 * Returns `showBadge=true` when density is below the threshold AND there
 * is at least one citation-required cell to evaluate. Zero-denominator
 * safety: with no citation-required cells (e.g., a synthetic schema), the
 * badge is suppressed rather than dividing by zero.
 */
export function computeEvidenceDensity(
  cells: CellRecord[],
  paramByKey: Map<string, Parameter>,
): { density: number; showBadge: boolean; sampled: number } {
  let citationRequired = 0;
  let citationPresent = 0;

  for (const cell of cells) {
    if (cell.confidence === "unknown") continue;
    const param = paramByKey.get(cell.parameter_key);
    if (!param || !param.citation_required) continue;
    citationRequired += 1;
    if (cell.citation !== null && cell.citation !== undefined) {
      citationPresent += 1;
    }
  }

  if (citationRequired === 0) {
    return { density: 1, showBadge: false, sampled: 0 };
  }

  const density = citationPresent / citationRequired;
  return {
    density,
    showBadge: density < THIN_EVIDENCE_THRESHOLD,
    sampled: citationRequired,
  };
}
