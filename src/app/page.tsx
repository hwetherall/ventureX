import Link from "next/link";
import { getCurrentUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { signOut } from "./login/actions";

interface VentureSummary {
  id: string;
  status: string;
  codename: string;
  created_at: string;
  user_provided_description: string;
}

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">VentureX</h1>
        <p className="mt-3 text-muted-foreground">
          Internal competitive-landscape tool. Upload a venture description and
          supporting documents to extract a structured 7-dimension profile.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const insforge = await createAuthedServerClient();
  const { data: rawVentures } = await insforge.database
    .from("ventures")
    .select("id, status, codename, created_at, user_provided_description")
    .order("created_at", { ascending: false })
    .limit(10);

  const ventures = (rawVentures ?? []) as VentureSummary[];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">VentureX</h1>
        <form action={signOut}>
          <button
            type="submit"
            className="text-xs underline underline-offset-4 text-muted-foreground"
          >
            Sign out ({user.email})
          </button>
        </form>
      </header>

      <p className="mt-3 text-sm text-muted-foreground">
        Internal competitive-landscape tool.{" "}
        <Link href="/ventures/new" className="underline underline-offset-4">
          Start a new venture
        </Link>{" "}
        to extract a 7-dimension profile.
      </p>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent ventures
          </h2>
          <Link
            href="/ventures/new"
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            + New venture
          </Link>
        </div>

        {ventures.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No ventures yet. Click <strong>+ New venture</strong> to upload your
            first case brief.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {ventures.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/ventures/${v.id}`}
                  className="block rounded-md border border-border p-3 text-sm hover:bg-muted"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {v.id.slice(0, 8)}
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {v.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">
                    {v.user_provided_description}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
