"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage3Candidates } from "@/server/stage3-candidates";

/**
 * @public
 * Discriminated result of {@link triggerStage3Generation}.
 *
 * Note: the success path is unreachable from the client. On success the action
 * calls `redirect()` (D8), which throws a Next.js redirect exception that
 * propagates past the function boundary — the `{ ok: true, ... }` branch is
 * kept in the type purely to document the success shape and to satisfy
 * type-narrowing in callers. The only branch a client `useTransition`
 * callback actually sees is `{ ok: false, error }`.
 */
export type TriggerStage3Result =
  | {
      ok: true;
      generationRunId: string;
      candidateCount: number;
      costUsd: number;
    }
  | { ok: false; error: string };

/**
 * @public
 * Server action behind the "Generate competitor candidates" button on
 * `/ventures/[id]`. Triggers Stage 3 (M12) candidate brainstorm.
 *
 * Belt-and-braces concurrency guard (P3-D5):
 *   - Client side: the button binds via `useTransition` so a second click
 *     is no-op while `isPending`.
 *   - Server side: `runStage3Candidates` enforces `status='ready'` before
 *     loading inputs. If the user beat the disabled state with a manual
 *     POST, the orchestrator rejects with a precondition error rather than
 *     spending budget on a duplicate run.
 *
 * Flow:
 *   1. Require an authenticated user (RLS depends on auth.uid()).
 *   2. Validate the venture id from the form payload.
 *   3. Build an authed InsForge client.
 *   4. Call `runStage3Candidates`. The orchestrator manages its own status
 *      transitions and `error_message` stamping on failure.
 *   5. On hard failure: revalidate the detail page (so the error banner
 *      surfaces) and return the discriminated error result.
 *   6. On success: revalidate both pages, then `redirect()` to
 *      `/ventures/[id]/candidates` (D8). The redirect throws past this
 *      function; the success return statement is unreachable but kept for
 *      type clarity.
 *
 * Wall time: ~10-30s on a typical ABB-shaped profile. Synchronous keeps the
 * state machine simple — same trade-off as Stage 1 + Stage 2 actions.
 */
export async function triggerStage3Generation(args: {
  ventureId: string;
}): Promise<TriggerStage3Result> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  if (!ventureId) {
    return { ok: false, error: "Missing ventureId." };
  }

  const insforge = await createAuthedServerClient();

  const result = await runStage3Candidates({ ventureId, insforge });

  if (!result.ok) {
    // Revalidate the detail page so the error banner (status='error' with
    // error_message) surfaces on the next paint. On the success path the
    // client follows the 307 below to /candidates, so revalidating the
    // detail page would be dead work — the user isn't going to render it.
    revalidatePath(`/ventures/${ventureId}`);
    return { ok: false, error: result.error };
  }

  // D8: auto-redirect to the candidates list. `redirect()` throws a Next.js
  // navigation exception that bubbles past this return — the line below is
  // unreachable at runtime but TypeScript needs it for the discriminated
  // return type.
  redirect(`/ventures/${ventureId}/candidates`);
}
