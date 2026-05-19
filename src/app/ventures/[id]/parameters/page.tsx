import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { ParameterSchema, type Parameter } from "@/types/parameter";

interface VentureRow {
  id: string;
  status: string;
  codename: string;
}

interface ParameterRunRow {
  id: string;
  candidate_generation_run_id: string;
  full_parameter_schema: unknown;
  generation_notes: string | null;
  created_at: string;
}

const TIER_LABELS: Record<Parameter["tier"], string> = {
  universal: "Universal",
  framework: "Framework",
  dynamic: "Dynamic",
};

const DIMENSION_LABELS: Record<Parameter["innovera_dimension"], string> = {
  meta: "Meta",
  product_solution: "Product",
  customers: "Customers",
  transaction: "Transaction",
  partners: "Partners",
  access: "Access",
  geography_regulatory: "Geography",
  capital_asset: "Capital",
};

const TIER_ORDER: Parameter["tier"][] = ["universal", "framework", "dynamic"];

export default async function ParametersPage({
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

  const { data: runRaw, error: runError } = await insforge.database
    .from("parameter_generation_runs")
    .select(
      "id, candidate_generation_run_id, full_parameter_schema, generation_notes, created_at",
    )
    .eq("venture_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Could not load parameters: {runError.message}
        </section>
      </main>
    );
  }

  if (!runRaw) {
    redirect(`/ventures/${id}`);
  }

  const run = runRaw as unknown as ParameterRunRow;
  const parsed = ParameterSchema.array().safeParse(run.full_parameter_schema);
  if (!parsed.success) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Stored parameter schema failed validation: {parsed.error.message}
        </section>
      </main>
    );
  }

  const parameters = parsed.data;
  const dynamicCount = parameters.filter((p) => p.tier === "dynamic").length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <PageHeader ventureId={id} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-1 font-medium">
          {parameters.length} parameters
        </span>
        <span className="rounded bg-muted px-2 py-1 font-medium">
          {dynamicCount} dynamic
        </span>
        <span className="rounded bg-muted px-2 py-1 font-mono">
          run {run.id.slice(0, 8)}
        </span>
        <span
          className={
            venture.status === "parameters_ready"
              ? "rounded bg-[color:var(--color-success-bg,transparent)] px-2 py-1 text-[color:var(--color-success-fg)] font-medium"
              : "rounded bg-muted px-2 py-1 font-medium"
          }
        >
          status: {venture.status}
        </span>
      </div>

      {run.generation_notes && (
        <p className="mt-6 rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
          {run.generation_notes}
        </p>
      )}

      {TIER_ORDER.map((tier) => (
        <ParameterTierSection
          key={tier}
          tier={tier}
          parameters={parameters.filter((p) => p.tier === tier)}
        />
      ))}
    </main>
  );
}

function ParameterTierSection({
  tier,
  parameters,
}: {
  tier: Parameter["tier"];
  parameters: Parameter[];
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {TIER_LABELS[tier]}
        </h2>
        <span className="text-xs text-muted-foreground">
          {parameters.length} parameters
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {parameters.map((parameter) => (
          <ParameterCard key={parameter.id} parameter={parameter} />
        ))}
      </div>
    </section>
  );
}

function ParameterCard({ parameter }: { parameter: Parameter }) {
  return (
    <article className="rounded-md border border-border bg-surface p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">{parameter.name}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {parameter.id}
          </p>
        </div>
        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {DIMENSION_LABELS[parameter.innovera_dimension]}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded bg-muted px-2 py-0.5 font-mono">
          {parameter.value_type}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 font-mono">
          {parameter.cell_budget}
        </span>
        {parameter.citation_required && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">
            cite
          </span>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {parameter.prompt_hint}
      </p>
      {parameter.source_field && (
        <p className="mt-3 break-all border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
          {parameter.source_field}
        </p>
      )}
    </article>
  );
}

function PageHeader({ ventureId }: { ventureId: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        Parameters{" "}
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
