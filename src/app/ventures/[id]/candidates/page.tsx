import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { predictStage5Cost } from "@/lib/openrouter/predict";
import { ParameterSchema, type Parameter } from "@/types/parameter";
import type { CandidateType, Citation } from "@/types/candidate";
import type { Dimension } from "@/types/venture-profile";
import { ResearchBatchButton } from "./research-batch-button";
import { ResearchDossierButton } from "./research-dossier-button";

interface VentureRow {
  id: string;
  status: string;
  codename: string;
}

interface CandidateRow {
  id: string;
  name: string;
  type: CandidateType;
  rationale: string;
  dimensions_implicated: Dimension[];
  citations: Citation[] | null;
  generation_run_id: string;
  created_at: string;
}

// Render order for the three categories. Direct first (the obvious incumbents),
// SPDM last because its rationales tend to be the longest and benefit from
// scrolling context. CLAUDE.md §2 kills "adjacent" — three categories total.
const TYPE_ORDER: CandidateType[] = [
  "direct",
  "category",
  "same_problem_different_mechanism",
];

const TYPE_LABELS: Record<CandidateType, string> = {
  direct: "Direct",
  category: "Category",
  same_problem_different_mechanism: "Same Problem, Different Mechanism",
};

const TYPE_SUBTITLES: Record<CandidateType, string> = {
  direct: "Same Job-to-be-Done, same mechanism.",
  category: "Same mechanism, different Job-to-be-Done.",
  same_problem_different_mechanism: "Same Job-to-be-Done, different mechanism.",
};

const DIMENSION_LABELS: Record<Dimension, string> = {
  product_solution: "Product",
  customers: "Customers",
  transaction: "Transaction",
  partners: "Partners",
  access: "Access",
  geography_regulatory: "Geography",
  capital_asset: "Capital",
};

export default async function CandidatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const insforge = await createAuthedServerClient();

  const { data: ventureRaw, error: ventureError } = await insforge.database
    .from("ventures")
    .select("id, status, codename")
    .eq("id", id)
    .single();

  if (ventureError || !ventureRaw) notFound();
  const venture = ventureRaw as unknown as VentureRow;

  // Pull every candidate row for this venture. We group by generation_run_id
  // client-side and show the latest run only — older runs stay as audit trail
  // (PHASE3.md §3, M13 will surface them once web-augmented runs coexist).
  const { data: rowsRaw, error: candidatesError } = await insforge.database
    .from("candidate_companies")
    .select(
      "id, name, type, rationale, dimensions_implicated, citations, generation_run_id, created_at",
    )
    .eq("venture_id", id)
    .order("created_at", { ascending: true });

  if (candidatesError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Could not load candidates: {candidatesError.message}
        </section>
      </main>
    );
  }

  const rows = (rowsRaw as CandidateRow[] | null) ?? [];

  // No candidates yet — send the user back to the venture detail page where
  // the Generate-candidates button (T6) will explain how to start a run.
  if (rows.length === 0) {
    redirect(`/ventures/${id}`);
  }

  // Latest generation_run_id wins. With `created_at ASC` ordering, the most
  // recent run's rows are at the end; group by run_id and pick the one whose
  // last row has the latest timestamp.
  const latestRunId = pickLatestGenerationRun(rows);
  const latestRows = rows.filter((r) => r.generation_run_id === latestRunId);

  // Stage 5 surface: when parameters exist, surface a per-candidate "Research
  // dossier" button + predictor estimate. When cells exist, swap for a
  // "View dossier" link.
  const dossierContext = await loadDossierContext(insforge, id, latestRows);

  // Bucket by type. Each candidate appears in exactly one section; within
  // a section we preserve insertion order from the LLM (the model's natural
  // grouping carries information about its confidence ordering).
  const byType: Record<CandidateType, CandidateRow[]> = {
    direct: [],
    category: [],
    same_problem_different_mechanism: [],
  };
  for (const row of latestRows) {
    byType[row.type].push(row);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader ventureId={id} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-1 font-medium">
          {latestRows.length} candidates
        </span>
        <span className="rounded bg-muted px-2 py-1 font-mono">
          run {latestRunId.slice(0, 8)}
        </span>
        <span
          className={
            venture.status === "candidates_ready"
              ? "rounded bg-[color:var(--color-success-bg,transparent)] px-2 py-1 text-[color:var(--color-success-fg)] font-medium"
              : "rounded bg-muted px-2 py-1 font-medium"
          }
        >
          status: {venture.status}
        </span>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Web-augmented brainstorm (M13). Each <code className="font-mono text-xs">implies_search_for</code>
        risk-string in the venture profile is run through Exa neural search; the
        Opus call gets the bundled evidence and grounds candidates in real URLs.
        Per-candidate citations appear inline below the rationale. Per-dimension
        scoring lands in M14.
      </p>

      <BatchResearchPanel
        ventureId={venture.id}
        ventureStatus={venture.status}
        candidates={latestRows}
        dossierContext={dossierContext}
      />

      {TYPE_ORDER.map((type) => (
        <CandidatesSection
          key={type}
          type={type}
          candidates={byType[type]}
          ventureStatus={venture.status}
          ventureId={venture.id}
          dossierContext={dossierContext}
        />
      ))}
    </main>
  );
}

function BatchResearchPanel({
  ventureId,
  ventureStatus,
  candidates,
  dossierContext,
}: {
  ventureId: string;
  ventureStatus: string;
  candidates: CandidateRow[];
  dossierContext: DossierContext;
}) {
  const unresearched = candidates.filter(
    (c) => !dossierContext.candidatesWithCells.has(c.id),
  );

  // Batch CTAs are meaningful when parameters exist and there are still
  // un-researched candidates. After cells_ready with everything researched
  // there's nothing left to do here — the table page is the next surface.
  if (
    ventureStatus !== "parameters_ready" &&
    ventureStatus !== "cells_ready"
  ) {
    return null;
  }
  if (unresearched.length === 0) {
    return null;
  }
  if (!dossierContext.prediction) {
    return null;
  }

  const tenIds = unresearched.slice(0, 10).map((c) => c.id);
  const allIds = unresearched.map((c) => c.id);

  return (
    <section className="mt-8 rounded-md border border-dashed border-border p-4 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Batch research ({unresearched.length} candidates not yet researched)
      </h2>
      <p className="mt-2 text-muted-foreground">
        Run cell research across multiple candidates in one pass. Each
        candidate's dossier is researched independently (T1 + T2 + T3) with
        a 3-candidate within-venture concurrency cap. Per-candidate failures
        are recorded but do not fail the whole batch.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {unresearched.length > 10 && (
          <ResearchBatchButton
            ventureId={ventureId}
            candidateIds={tenIds}
            perCandidatePrediction={dossierContext.prediction}
            label={`Research 10 candidates`}
          />
        )}
        <ResearchBatchButton
          ventureId={ventureId}
          candidateIds={allIds}
          perCandidatePrediction={dossierContext.prediction}
          label={`Research all ${unresearched.length}`}
        />
      </div>
    </section>
  );
}

interface DossierContext {
  prediction: {
    costMin: number;
    costMax: number;
    latencyMinMin: number;
    latencyMaxMin: number;
  } | null;
  candidatesWithCells: Set<string>;
}

/**
 * Load the latest parameter schema (so we can predict per-candidate cost +
 * latency) and the set of candidates that already have cells written. The
 * candidates page renders a different CTA per candidate depending on
 * whether its dossier exists.
 */
async function loadDossierContext(
  insforge: Awaited<ReturnType<typeof createAuthedServerClient>>,
  ventureId: string,
  candidates: CandidateRow[],
): Promise<DossierContext> {
  const { data: paramRunRaw } = await insforge.database
    .from("parameter_generation_runs")
    .select("full_parameter_schema")
    .eq("venture_id", ventureId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let prediction: DossierContext["prediction"] = null;
  if (paramRunRaw) {
    const rawSchema = (paramRunRaw as { full_parameter_schema: unknown })
      .full_parameter_schema;
    if (Array.isArray(rawSchema)) {
      const parsed: Parameter[] = [];
      for (const entry of rawSchema) {
        const ok = ParameterSchema.safeParse(entry);
        if (ok.success) parsed.push(ok.data);
      }
      if (parsed.length > 0) {
        const p = predictStage5Cost({ parameters: parsed, candidateCount: 1 });
        prediction = {
          costMin: p.costUsd.min,
          costMax: p.costUsd.max,
          latencyMinMin: Math.round(p.latencyMs.min / 60_000),
          latencyMaxMin: Math.round(p.latencyMs.max / 60_000),
        };
      }
    }
  }

  // Which candidates already have at least one cell? InsForge/PostgREST caps
  // responses at 1000 rows server-side, so with 42 candidates × ~55 cells the
  // unsorted tail gets dropped and candidates that landed last erroneously
  // present as "no cells" in the candidates page. Page explicitly to defeat
  // the cap. (Same root cause as the comparison table truncation fix in
  // src/lib/table-data.ts.)
  const candidateIds = candidates.map((c) => c.id);
  const candidatesWithCells = new Set<string>();
  if (candidateIds.length > 0) {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: cellsProbeRaw } = await insforge.database
        .from("cells")
        .select("candidate_id")
        .in("candidate_id", candidateIds)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      const rows = (cellsProbeRaw ?? []) as { candidate_id: string }[];
      for (const row of rows) candidatesWithCells.add(row.candidate_id);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  return { prediction, candidatesWithCells };
}

function CandidatesSection({
  type,
  candidates,
  ventureStatus,
  ventureId,
  dossierContext,
}: {
  type: CandidateType;
  candidates: CandidateRow[];
  ventureStatus: string;
  ventureId: string;
  dossierContext: DossierContext;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {TYPE_LABELS[type]}
        </h2>
        <span className="text-xs text-muted-foreground">
          {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {TYPE_SUBTITLES[type]}
      </p>

      <ul className="mt-5 space-y-3">
        {candidates.length === 0 && (
          <li className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
            No candidates surfaced in this category. The prompt enforces a
            soft floor of 5 per category — if this is empty after a real run,
            iterate on{" "}
            <code className="font-mono">
              prompts/stage_3_candidate_generation.md
            </code>
            .
          </li>
        )}
        {candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            ventureStatus={ventureStatus}
            ventureId={ventureId}
            dossierContext={dossierContext}
          />
        ))}
      </ul>
    </section>
  );
}

function CandidateCard({
  candidate,
  ventureStatus,
  ventureId,
  dossierContext,
}: {
  candidate: CandidateRow;
  ventureStatus: string;
  ventureId: string;
  dossierContext: DossierContext;
}) {
  const citations = candidate.citations ?? [];
  return (
    <li className="rounded-md border border-border bg-surface p-4 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-foreground">{candidate.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {candidate.dimensions_implicated.map((dim) => (
            <span
              key={dim}
              className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              title={dim}
            >
              {DIMENSION_LABELS[dim]}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
        {candidate.rationale}
      </p>
      {citations.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {citations.map((c, i) => (
            <li
              key={`${candidate.id}-${i}`}
              className="text-xs text-muted-foreground"
            >
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--color-accent)] underline underline-offset-2 hover:text-[color:var(--color-accent-hover)]"
              >
                {c.title || c.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      <CandidateDossierCta
        candidate={candidate}
        ventureStatus={ventureStatus}
        ventureId={ventureId}
        dossierContext={dossierContext}
      />
    </li>
  );
}

function CandidateDossierCta({
  candidate,
  ventureStatus,
  ventureId,
  dossierContext,
}: {
  candidate: CandidateRow;
  ventureStatus: string;
  ventureId: string;
  dossierContext: DossierContext;
}) {
  const hasCells = dossierContext.candidatesWithCells.has(candidate.id);

  if (hasCells) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <Link
          href={`/ventures/${ventureId}/dossier/${candidate.id}`}
          className="inline-block rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          View dossier →
        </Link>
      </div>
    );
  }

  if (ventureStatus !== "parameters_ready" && ventureStatus !== "cells_ready") {
    return null;
  }

  if (!dossierContext.prediction) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        Generate parameters before researching this candidate's dossier.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <ResearchDossierButton
        ventureId={ventureId}
        candidateId={candidate.id}
        candidateName={candidate.name}
        prediction={dossierContext.prediction}
      />
    </div>
  );
}

function PageHeader({ ventureId }: { ventureId: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        Candidates{" "}
        <span className="font-mono text-base">{ventureId.slice(0, 8)}</span>
      </h1>
      <Link
        href={`/ventures/${ventureId}`}
        className="text-xs underline underline-offset-4 text-muted-foreground"
      >
        ← Venture
      </Link>
    </div>
  );
}

/**
 * Pick the most-recent `generation_run_id` from a list of candidate rows
 * pre-sorted by `created_at` ascending. The last row's run_id wins because
 * a single Stage 3 call inserts all of its rows in one batch — they share a
 * created_at within microseconds, and any later run's rows are strictly after.
 */
function pickLatestGenerationRun(rows: CandidateRow[]): string {
  // rows is non-empty by the caller's guard.
  return rows[rows.length - 1]!.generation_run_id;
}
