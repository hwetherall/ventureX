"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage6Scoring } from "@/server/stage6-score";

export type TriggerCandidateScoringResult =
  | {
      ok: true;
      scoredCount: number;
      skippedCount: number;
      failedCount: number;
      costUsd: number;
    }
  | { ok: false; error: string };

export async function triggerCandidateScoring(args: {
  ventureId: string;
}): Promise<TriggerCandidateScoringResult> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  if (!ventureId) {
    return { ok: false, error: "Missing ventureId." };
  }

  const insforge = await createAuthedServerClient();
  const result = await runStage6Scoring({ ventureId, insforge });

  revalidatePath(`/ventures/${ventureId}/table`);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    scoredCount: result.scored.length,
    skippedCount: result.skipped.length,
    failedCount: result.failed.length,
    costUsd: result.costUsd,
  };
}
