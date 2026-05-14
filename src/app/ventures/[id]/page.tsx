import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";

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
  created_at: string;
  venture_documents: VentureDocument[];
}

const STATUS_LABELS: Record<string, string> = {
  intake: "Intake",
  extracting: "Extracting profile (Stage 1)",
  awaiting_refinement: "Awaiting human review",
  weighting: "Weighting dimensions",
  ready: "Ready",
  error: "Error",
};

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
      "id, user_provided_description, codename, status, critic_status, created_at, venture_documents(id, filename, mime_type, parsed_at, parse_error)",
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
            <span className="ml-2 text-red-700 normal-case">
              {errorCount} failed
            </span>
          )}
          {parsedCount > 0 && errorCount === 0 && (
            <span className="ml-2 text-green-700 normal-case">
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
                  <span className="text-red-700">Error: {doc.parse_error}</span>
                ) : doc.parsed_at ? (
                  <span className="text-green-700">
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

      {venture.status === "extracting" && (
        <section className="mt-8 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Stage 1 extraction will pick this up automatically once M7 lands.
          For now the venture sits at <code>extracting</code> with the parsed
          markdown already in the database, ready for the orchestrator to fire.
        </section>
      )}
    </main>
  );
}
