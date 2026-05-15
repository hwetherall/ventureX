import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import type { CandidateType } from "@/types/candidate";
import type { Dimension } from "@/types/venture-profile";

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
      "id, name, type, rationale, dimensions_implicated, generation_run_id, created_at",
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
        LLM-only brainstorm (M12). Web-augmented evidence and per-dimension
        scoring land in M13 and M14 respectively. Eyeball the list against the
        venture profile; flag obvious misses for the next prompt iteration.
      </p>

      {TYPE_ORDER.map((type) => (
        <CandidatesSection
          key={type}
          type={type}
          candidates={byType[type]}
        />
      ))}
    </main>
  );
}

function CandidatesSection({
  type,
  candidates,
}: {
  type: CandidateType;
  candidates: CandidateRow[];
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
          <CandidateCard key={c.id} candidate={c} />
        ))}
      </ul>
    </section>
  );
}

function CandidateCard({ candidate }: { candidate: CandidateRow }) {
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
    </li>
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
