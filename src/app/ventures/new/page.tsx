import { requireUser } from "@/lib/insforge/auth";
import { NewVentureForm } from "./form";

export const metadata = {
  title: "New venture — VentureX",
};

export default async function NewVenturePage() {
  // requireUser() redirects to /login if there's no session.
  await requireUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">New venture</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a venture description and supporting documents to begin
        extraction. Stage 0 parses the documents synchronously; Stage 1
        extraction runs after that (wiring lands in M7).
      </p>

      <NewVentureForm />
    </main>
  );
}
