import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import {
  Stage1CriticOutputSchema,
  VentureProfileSchema,
  type Stage1CriticOutput,
  type VentureProfile,
} from "@/types/venture-profile";
import { RefineClient } from "./refine-client";

interface VentureRow {
  id: string;
  status: string;
  critic_status: string;
  user_provided_description: string;
}

interface ProfileVersionRow {
  id: string;
  version_number: number;
  source: "llm_extracted" | "llm_critic" | "human_refined";
  profile_json: unknown;
  created_at: string;
}

export default async function RefinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const insforge = await createAuthedServerClient();

  const { data: ventureRaw, error: ventureError } = await insforge.database
    .from("ventures")
    .select("id, status, critic_status, user_provided_description")
    .eq("id", id)
    .single();

  if (ventureError || !ventureRaw) notFound();
  const venture = ventureRaw as unknown as VentureRow;

  // Guard: HITL only makes sense once Stage 1 has produced a profile. If the
  // venture is pre-extraction, send the user back to the detail page where the
  // "Run Stage 1" button lives.
  if (venture.status === "intake" || venture.status === "extracting") {
    redirect(`/ventures/${id}`);
  }

  // Load the most recent refinable row (extracted or refined). This is what
  // the client edits against.
  const { data: refinableRaw } = await insforge.database
    .from("profile_versions")
    .select("id, version_number, source, profile_json, created_at")
    .eq("venture_id", id)
    .in("source", ["llm_extracted", "human_refined"])
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const refinableRow = (refinableRaw as ProfileVersionRow | null) ?? null;

  if (!refinableRow) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] p-4 text-sm text-[color:var(--color-warning-fg)]">
          No extracted profile exists for this venture yet. Run Stage 1 first.
          <div className="mt-3">
            <Link
              href={`/ventures/${id}`}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
            >
              ← Back to venture
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const profileParsed = VentureProfileSchema.safeParse(refinableRow.profile_json);
  if (!profileParsed.success) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader ventureId={id} />
        <section className="mt-8 rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-4 text-sm text-[color:var(--color-error-fg)]">
          Latest profile row (v{refinableRow.version_number}, source={" "}
          <code>{refinableRow.source}</code>) does not validate against the
          current schema:
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
            {profileParsed.error.message}
          </pre>
        </section>
      </main>
    );
  }
  const profile: VentureProfile = profileParsed.data;

  // Latest critic row (if any). Soft-fail leaves no row, which is fine.
  const { data: criticRaw } = await insforge.database
    .from("profile_versions")
    .select("id, version_number, source, profile_json, created_at")
    .eq("venture_id", id)
    .eq("source", "llm_critic")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let critic: Stage1CriticOutput | null = null;
  const criticRow = (criticRaw as ProfileVersionRow | null) ?? null;
  if (criticRow) {
    const parsed = Stage1CriticOutputSchema.safeParse(criticRow.profile_json);
    if (parsed.success) critic = parsed.data;
    // If a critic row exists but fails schema validation we just drop it
    // silently — the soft-fail banner will surface from critic_status.
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader ventureId={id} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-1 font-medium">
          Editing v{refinableRow.version_number} ({refinableRow.source})
        </span>
        {critic && (
          <span className="rounded bg-muted px-2 py-1">
            Critic v{criticRow!.version_number}
          </span>
        )}
        {venture.critic_status === "unavailable" && (
          <span className="rounded bg-[color:var(--color-warning-bg)] px-2 py-1 font-medium text-[color:var(--color-warning-fg)]">
            Critic unavailable
          </span>
        )}
      </div>

      {venture.critic_status === "unavailable" && (
        <section className="mt-6 rounded-md border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] p-4 text-sm text-[color:var(--color-warning-fg)]">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            Critic soft-failed (D3)
          </h2>
          <p className="mt-2">
            The second-model critic could not complete on this profile after
            one retry. Refinement can proceed — but you won&apos;t see flagged
            weaknesses inline. Consider re-running Stage 1 if you want a
            critic pass before refining.
          </p>
        </section>
      )}

      <RefineClient
        ventureId={id}
        initialProfile={profile}
        critic={critic}
        ventureDescription={venture.user_provided_description}
        ventureStatus={venture.status}
      />
    </main>
  );
}

function PageHeader({ ventureId }: { ventureId: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">
        Refine{" "}
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
