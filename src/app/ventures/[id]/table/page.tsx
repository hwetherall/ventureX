import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { loadComparisonTableData } from "@/lib/table-data";
import { ComparisonTableViewer } from "./table-viewer";

export default async function VentureTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const insforge = await createAuthedServerClient();
  const { data, error } = await loadComparisonTableData(insforge, id);

  if (!data && !error) notFound();

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Could not load comparison table: {error ?? "No table data found."}
        </section>
      </main>
    );
  }

  if (data.parameters.length === 0 || data.candidates.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          The comparison table needs a parameter schema and at least one
          candidate. Generate candidates and parameters before opening the
          aggregate viewer.
        </section>
      </main>
    );
  }

  return <ComparisonTableViewer data={data} ventureId={id} />;
}

function PageHeader({ ventureId }: { ventureId: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        Comparison table
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
