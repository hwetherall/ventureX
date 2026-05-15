import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { submitStage1ExtractionForm } from "./actions";
import { GenerateCandidatesButton } from "./generate-candidates-button";

interface VentureDocument {
  id: string;
  filename: string;
  mime_type: string;
  parsed_at: string | null;
  parse_error: string | null;
}

interface VentureWithDocs {
  id: string;
  user_provided_description: string;
  codename: string;
  status: string;
  critic_status: string;
  error_message: string | null;
  current_run_id: string | null;
  created_at: string;
  venture_documents: VentureDocument[];
}

interface LatestProfileRow {
  id: string;
  version_number: number;
  source: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  intake: "Intake",
  extracting: "Extracting profile (Stage 1)",
  awaiting_refinement: "Awaiting human review",
  weighting: "Weighting dimensions",
  ready: "Ready",
  candidates_generating: "Generating candidates (Stage 3)",
  candidates_ready: "Candidates ready",
  error: "Error",
};

// Statuses where it's safe to (re-)launch Stage 1 from a button.
// `extracting` is included so the user can recover from a server crash mid-run.
const STATUSES_RUNNABLE = new Set([
  "intake",
  "extracting",
  "awaiting_refinement",
  "error",
]);

export default async function VenturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const insforge = await createAuthedServerClient();

  const { data: ventureRaw, error } = await insforge.database
    .from("ventures")
    .select(
      "id, user_provided_description, codename, status, critic_status, error_message, current_run_id, created_at, venture_documents(id, filename, mime_type, parsed_at, parse_error)",
    )
    .eq("id", id)
    .single();

  if (error || !ventureRaw) {
    notFound();
  }

  const venture = ventureRaw as unknown as VentureWithDocs;
  const docs = venture.venture_documents ?? [];
  const parsedCount = docs.filter((d) => d.parsed_at).length;
  const errorCount = docs.filter((d) => d.parse_error).length;
  const parsedDocsAvailable = docs.some(
    (d) => d.parsed_at && !d.parse_error,
  );

  const { data: latestProfileRaw } = await insforge.database
    .from("profile_versions")
    .select("id, version_number, source, created_at")
    .eq("venture_id", id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestProfile = (latestProfileRaw as LatestProfileRow | null) ?? null;

  // Candidate existence check drives the Stage 3 CTA visibility. We don't
  // need the candidate rows themselves here — the candidates page reads them.
  // A `select("id").limit(1)` is the cheapest existence probe under RLS.
  const { data: candidateProbeRaw } = await insforge.database
    .from("candidate_companies")
    .select("id")
    .eq("venture_id", id)
    .limit(1);
  const candidatesExist = (candidateProbeRaw ?? []).length > 0;

  const canRunStage1 =
    STATUSES_RUNNABLE.has(venture.status) && parsedDocsAvailable;
  const isFirstRun = !latestProfile;
  const buttonLabel = isFirstRun ? "Run Stage 1 extraction" : "Re-run Stage 1";

  // Stage 2 weights view is meaningful once weights exist (status='weighting')
  // and remains useful as a read-only audit surface afterward.
  const showWeightsLink =
    venture.status === "weighting" ||
    venture.status === "ready" ||
    venture.status === "candidates_generating" ||
    venture.status === "candidates_ready";

  // Stage 3 trigger surfaces only when the venture is fully through Stage 2
  // confirmation AND no candidate set already exists. Re-runs require a
  // manual reset back to 'ready' (M13 will add an explicit affordance).
  const showGenerateCandidates =
    venture.status === "ready" && !candidatesExist;

  const showCandidatesLink = candidatesExist;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Venture <span className="font-mono text-base">{venture.id.slice(0, 8)}</span>
        </h1>
        <Link
          href="/"
          className="text-xs underline underline-offset-4 text-muted-foreground"
        >
          ← Home
        </Link>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-1 font-medium">
          {STATUS_LABELS[venture.status] ?? venture.status}
        </span>
        <span className="text-muted-foreground">
          Created {new Date(venture.created_at).toLocaleString()}
        </span>
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {venture.user_provided_description}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents ({docs.length})
          {errorCount > 0 && (
            <span className="ml-2 normal-case text-[color:var(--color-error-fg)]">
              {errorCount} failed
            </span>
          )}
          {parsedCount > 0 && errorCount === 0 && (
            <span className="ml-2 normal-case text-[color:var(--color-success-fg)]">
              all parsed
            </span>
          )}
        </h2>
        <ul className="mt-2 space-y-2">
          {docs.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No documents attached.
            </li>
          )}
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium truncate">{doc.filename}</span>
                <span className="text-xs text-muted-foreground">
                  {doc.mime_type === "application/pdf" ? "PDF" : "DOCX"}
                </span>
              </div>
              <div className="mt-1 text-xs">
                {doc.parse_error ? (
                  <span className="text-[color:var(--color-error-fg)]">Error: {doc.parse_error}</span>
                ) : doc.parsed_at ? (
                  <span className="text-[color:var(--color-success-fg)]">
                    Parsed at {new Date(doc.parsed_at).toLocaleTimeString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Pending parse</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {venture.status === "error" && venture.error_message && (
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-error-fg)]">
            Stage 1 error
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[color:var(--color-error-fg)]">
            {venture.error_message}
          </p>
        </section>
      )}

      {latestProfile && (
        <section className="mt-8 rounded-md border border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Latest profile version
          </h2>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-mono">v{latestProfile.version_number}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              {latestProfile.source}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(latestProfile.created_at).toLocaleString()}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(venture.status === "awaiting_refinement" ||
              venture.status === "weighting" ||
              venture.status === "ready" ||
              venture.status === "candidates_generating" ||
              venture.status === "candidates_ready") && (
              <Link
                href={`/ventures/${venture.id}/refine`}
                className="inline-block rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Open HITL refinement →
              </Link>
            )}
            {showWeightsLink && (
              <Link
                href={`/ventures/${venture.id}/weights`}
                className="inline-block rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Open weights →
              </Link>
            )}
            {showCandidatesLink && (
              <Link
                href={`/ventures/${venture.id}/candidates`}
                className="inline-block rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Open candidates →
              </Link>
            )}
          </div>
        </section>
      )}

      {showGenerateCandidates && (
        <section className="mt-8 rounded-md border border-dashed border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stage 3 — Candidate generation
          </h2>
          <p className="mt-2 text-muted-foreground">
            Brainstorm 36–45 competitor candidates across the three categories
            (Direct / Category / Same-Problem-Different-Mechanism) using the
            human-refined profile + canonical dimension weights. LLM-only at
            M12; web-augmented evidence lands in M13.
          </p>
          <div className="mt-3">
            <GenerateCandidatesButton ventureId={venture.id} />
          </div>
        </section>
      )}

      {venture.status === "candidates_generating" && !candidatesExist && (
        <section className="mt-8 rounded-md border border-dashed border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stage 3 in progress
          </h2>
          <p className="mt-2 text-muted-foreground">
            Candidate brainstorm running. The page will redirect to the
            candidates list automatically when complete.
          </p>
        </section>
      )}

      {canRunStage1 && (
        <section className="mt-8 rounded-md border border-dashed border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isFirstRun ? "Stage 1 — Profile extraction" : "Re-run Stage 1"}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {isFirstRun
              ? "Run the frontier model against your description + parsed documents to produce a v1 profile. Expect 30–120 seconds."
              : "Generates a new profile_versions row at the next version number. Re-runs reset the per-run $5 budget."}
          </p>
          <form action={submitStage1ExtractionForm} className="mt-3">
            <input type="hidden" name="ventureId" value={venture.id} />
            <button
              type="submit"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              {buttonLabel}
            </button>
          </form>
        </section>
      )}

      {!parsedDocsAvailable && docs.length > 0 && (
        <section className="mt-8 rounded-md border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] p-4 text-xs text-[color:var(--color-warning-fg)]">
          Stage 1 cannot run: no documents parsed successfully. Re-upload or
          fix the failing files before extracting.
        </section>
      )}
    </main>
  );
}
