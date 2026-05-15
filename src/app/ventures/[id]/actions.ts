"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage1Critic } from "@/server/stage1-critic";
import { runStage1Extraction } from "@/server/stage1-extract";

/**
 * @public
 * Discriminated result of {@link triggerStage1Extraction}.
 *
 * `criticStatus` is only meaningful on the success path. `'unavailable'`
 * signals a D3 soft-fail — the venture is still in `awaiting_refinement`
 * and the HITL UI should render a yellow banner.
 */
export type TriggerStage1Result =
  | {
      ok: true;
      profileVersionId: string;
      runId: string;
      criticStatus: "success" | "unavailable";
      criticReason?: string;
    }
  | { ok: false; error: string };

/**
 * Server action behind the "Run Stage 1" / "Re-run extraction" button on
 * /ventures/[id]. Orchestrates BOTH stages of the Stage 1 pipeline:
 *
 *   1. Require an authenticated user (RLS depends on auth.uid()).
 *   2. Validate the venture id from the form payload.
 *   3. Build an authed InsForge client.
 *   4. Run extraction. If it fails hard, return immediately — the
 *      orchestrator has already stamped `status='error'`.
 *   5. On extraction success, chain into the Stage 1 Critic. The critic
 *      runs synchronously here (D3 soft-fail design tolerates the ~30s
 *      retry wait inside this action). The critic handles its own
 *      `status='awaiting_refinement'` transition on success OR soft-fail.
 *   6. Revalidate the detail page once at the end so the new status +
 *      profile versions surface on the next paint.
 *
 * Total worst-case wall time on Vercel: ~5 min (Stage 1 up to 180s +
 * 30s D3 wait + critic retry up to 180s). Verify your Vercel function
 * timeout is generous enough; if not, move the critic to a route handler
 * triggered post-extraction.
 */
export async function triggerStage1Extraction(
  formData: FormData,
): Promise<TriggerStage1Result> {
  await requireUser();

  const ventureId = String(formData.get("ventureId") ?? "").trim();
  if (!ventureId) {
    return { ok: false, error: "Missing ventureId in request." };
  }

  const insforge = await createAuthedServerClient();

  const extractResult = await runStage1Extraction({ ventureId, insforge });
  if (!extractResult.ok) {
    revalidatePath(`/ventures/${ventureId}`);
    return { ok: false, error: extractResult.error };
  }

  const criticResult = await runStage1Critic({ ventureId, insforge });
  revalidatePath(`/ventures/${ventureId}`);

  if (!criticResult.ok) {
    // Critic threw a hard error (budget exhausted, DB write failure, etc).
    // Extraction already succeeded, so a profile_versions row exists — but
    // the venture is now in `status='error'` per the critic orchestrator.
    return { ok: false, error: criticResult.error };
  }

  if (criticResult.criticStatus === "success") {
    return {
      ok: true,
      profileVersionId: extractResult.profileVersionId,
      runId: extractResult.runId,
      criticStatus: "success",
    };
  }

  // D3 soft-fail: extraction landed, critic did not, status='awaiting_refinement'
  // with critic_status='unavailable'. HITL UI shows a banner.
  return {
    ok: true,
    profileVersionId: extractResult.profileVersionId,
    runId: extractResult.runId,
    criticStatus: "unavailable",
    criticReason: criticResult.reason,
  };
}

/**
 * Void-returning wrapper for `<form action={...}>` bindings in Server
 * Components. React's form action type expects `void | Promise<void>` even
 * though server actions can technically return data; if the data is needed
 * client-side, callers should use `useActionState(triggerStage1Extraction, …)`
 * instead of this wrapper. Status updates surface via the revalidated page.
 */
export async function submitStage1ExtractionForm(
  formData: FormData,
): Promise<void> {
  await triggerStage1Extraction(formData);
}
