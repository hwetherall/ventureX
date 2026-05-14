"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage1Extraction } from "@/server/stage1-extract";

export type TriggerStage1Result =
  | { ok: true; profileVersionId: string; runId: string }
  | { ok: false; error: string };

/**
 * Server action behind the "Run Stage 1" / "Re-run extraction" button on
 * /ventures/[id]. Thin wrapper around the orchestrator:
 *
 *   1. Require an authenticated user (RLS depends on auth.uid()).
 *   2. Validate the venture id from the form payload.
 *   3. Build an authed InsForge client and hand it to the orchestrator.
 *   4. Revalidate the detail page so the new status / latest profile row
 *      render on the next paint.
 *
 * The orchestrator already writes `status='error'` + `error_message` on
 * failure, so this action does not need its own try/catch — it just
 * forwards the discriminated result. revalidatePath runs in both paths
 * so the error UI surfaces immediately.
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
  const result = await runStage1Extraction({ ventureId, insforge });

  revalidatePath(`/ventures/${ventureId}`);

  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    profileVersionId: result.profileVersionId,
    runId: result.runId,
  };
}
