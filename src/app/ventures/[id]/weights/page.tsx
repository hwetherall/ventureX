import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import {
  DIMENSION_KEYS,
  type Dimension,
} from "@/types/venture-profile";
import { WeightsClient, type LatestWeight } from "./weights-client";

interface VentureRow {
  id: string;
  status: string;
}

interface ProfileVersionRow {
  id: string;
  version_number: number;
  source: "llm_extracted" | "llm_critic" | "human_refined";
}

interface DimensionWeightRow {
  id: string;
  dimension: Dimension;
  weight: number;
  rationale: string | null;
  source: "llm_proposed" | "human_adjusted";
  profile_version_id: string;
  created_at: string;
}

export default async function WeightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const insforge = await createAuthedServerClient();

  const { data: ventureRaw, error: ventureError } = await insforge.database
    .from("ventures")
    .select("id, status")
    .eq("id", id)
    .single();

  if (ventureError || !ventureRaw) notFound();
  const venture = ventureRaw as unknown as VentureRow;

  // Gate: the weights view only makes sense after Stage 2 has produced
  // proposed weights. Anything earlier sends the user back to refine.
  if (
    venture.status !== "weighting" &&
    venture.status !== "ready" &&
    venture.status !== "error"
  ) {
    redirect(`/ventures/${id}/refine`);
  }

  // The dimension_weights rows reference a profile_version_id. We surface
  // it for context but the canonical input is whichever rows actually
  // exist — we don't re-derive from the profile here.
  const { data: profileRowRaw } = await insforge.database
    .from("profile_versions")
    .select("id, version_number, source")
    .eq("venture_id", id)
    .in("source", ["llm_extracted", "human_refined"])
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const profileRow = (profileRowRaw as ProfileVersionRow | null) ?? null;

  // Pull all dimension_weights rows for this venture. We keep the latest
  // row per dimension (by created_at desc); both `llm_proposed` and
  // `human_adjusted` rows are eligible, the timeline wins. Per
  // CLAUDE.md §11 we never UPDATE — readers always pick the newest.
  const { data: weightRowsRaw, error: weightsError } = await insforge.database
    .from("dimension_weights")
    .select(
      "id, dimension, weight, rationale, source, profile_version_id, created_at",
    )
    .eq("venture_id", id)
    .order("created_at", { ascending: false });

  if (weightsError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Could not load weights: {weightsError.message}
        </section>
      </main>
    );
  }

  const allRows = (weightRowsRaw as DimensionWeightRow[] | null) ?? [];
  const latestByDim = new Map<Dimension, LatestWeight>();
  for (const row of allRows) {
    if (!latestByDim.has(row.dimension)) {
      latestByDim.set(row.dimension, {
        dimension: row.dimension,
        weight: row.weight,
        rationale: row.rationale ?? "",
        source: row.source,
        profileVersionId: row.profile_version_id,
      });
    }
  }

  const missing = DIMENSION_KEYS.filter((d) => !latestByDim.has(d));
  if (missing.length > 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] p-4 text-sm text-[color:var(--color-warning-fg)]">
          Weights are incomplete (missing: {missing.join(", ")}). Stage 2 may
          not have run yet, or the run failed mid-insert. Re-run from the
          refine page&apos;s &quot;Confirm to continue&quot; button.
          <div className="mt-3">
            <Link
              href={`/ventures/${id}/refine`}
              className="inline-block rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
            >
              ← Back to refine
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // Render in canonical dimension order, not insertion order.
  const initialWeights: LatestWeight[] = DIMENSION_KEYS.map(
    (d) => latestByDim.get(d)!,
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader ventureId={id} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {profileRow && (
          <span className="rounded bg-muted px-2 py-1 font-medium">
            Weighting v{profileRow.version_number} ({profileRow.source})
          </span>
        )}
        <span
          className={
            venture.status === "ready"
              ? "rounded bg-[color:var(--color-success-bg,transparent)] px-2 py-1 text-[color:var(--color-success-fg)] font-medium"
              : "rounded bg-muted px-2 py-1 font-medium"
          }
        >
          status: {venture.status}
        </span>
      </div>

      <WeightsClient
        ventureId={id}
        initialWeights={initialWeights}
        ventureStatus={venture.status}
      />
    </main>
  );
}

function PageHeader({ ventureId }: { ventureId: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        Weights{" "}
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
