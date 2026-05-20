"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import {
  runStage5CellResearch,
  runStage5CellResearchMulti,
} from "@/server/stage5-cells";

export type ResetCellResearchResult =
  | { ok: true; cellsDeleted: number; exaLogsDeleted: number }
  | { ok: false; error: string };

/**
 * Admin: wipe all cells + exa_call_logs for this venture and flip the
 * status back to `parameters_ready` so the user can re-run cell research
 * without touching InsForge directly.
 *
 * Destructive. The caller's UI is expected to gate this behind a
 * confirmation dialog.
 */
export async function resetCellResearch(args: {
  ventureId: string;
}): Promise<ResetCellResearchResult> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  if (!ventureId) {
    return { ok: false, error: "Missing ventureId." };
  }

  const insforge = await createAuthedServerClient();

  // 1. Find candidate ids under this venture (RLS already scopes to owner).
  const { data: candidateRows, error: candidateErr } = await insforge.database
    .from("candidate_companies")
    .select("id")
    .eq("venture_id", ventureId);

  if (candidateErr) {
    return {
      ok: false,
      error: `Failed to load candidates: ${candidateErr.message}`,
    };
  }

  const candidateIds = ((candidateRows ?? []) as { id: string }[]).map(
    (row) => row.id,
  );

  let cellsDeleted = 0;
  let exaLogsDeleted = 0;

  if (candidateIds.length > 0) {
    // 2. Delete cells.
    const { data: cellsBefore } = await insforge.database
      .from("cells")
      .select("id")
      .in("candidate_id", candidateIds);
    cellsDeleted = (cellsBefore ?? []).length;

    const { error: cellsErr } = await insforge.database
      .from("cells")
      .delete()
      .in("candidate_id", candidateIds);
    if (cellsErr) {
      return { ok: false, error: `Failed to delete cells: ${cellsErr.message}` };
    }

    // 3. Delete exa_call_logs for this venture.
    const { data: exaBefore } = await insforge.database
      .from("exa_call_logs")
      .select("id")
      .eq("venture_id", ventureId);
    exaLogsDeleted = (exaBefore ?? []).length;

    const { error: exaErr } = await insforge.database
      .from("exa_call_logs")
      .delete()
      .eq("venture_id", ventureId);
    if (exaErr) {
      return {
        ok: false,
        error: `Failed to delete exa_call_logs: ${exaErr.message}`,
      };
    }
  }

  // 4. Reset venture status. Only flip if currently in a cell-research state
  // — don't accidentally clobber an earlier-stage status if the user clicks
  // this from a stale page.
  const { error: statusErr } = await insforge.database
    .from("ventures")
    .update({ status: "parameters_ready", error_message: null })
    .eq("id", ventureId)
    .in("status", ["cells_researching", "cells_ready", "error"]);

  if (statusErr) {
    return {
      ok: false,
      error: `Failed to reset venture status: ${statusErr.message}`,
    };
  }

  revalidatePath(`/ventures/${ventureId}`);
  revalidatePath(`/ventures/${ventureId}/candidates`);
  revalidatePath(`/ventures/${ventureId}/table`);
  return { ok: true, cellsDeleted, exaLogsDeleted };
}

export type TriggerCellResearchResult =
  | {
      ok: true;
      candidateId: string;
      cellsWritten: number;
      unknownCount: number;
      costUsd: number;
      latencyMs: number;
    }
  | { ok: false; error: string };

/**
 * Server action behind the per-candidate "Research dossier" button on
 * /ventures/[id]/candidates. V1 ships single-candidate at a time — the
 * caller picks the candidate from the candidates page and triggers
 * Stage 5 for that one. On success, redirects to the dossier page so the
 * consultant lands on the verification surface.
 */
export async function triggerCellResearch(args: {
  ventureId: string;
  candidateId: string;
}): Promise<TriggerCellResearchResult> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  const candidateId = args.candidateId.trim();
  if (!ventureId || !candidateId) {
    return { ok: false, error: "Missing ventureId or candidateId." };
  }

  const insforge = await createAuthedServerClient();
  const result = await runStage5CellResearch({
    ventureId,
    candidateId,
    insforge,
  });

  if (!result.ok) {
    revalidatePath(`/ventures/${ventureId}`);
    revalidatePath(`/ventures/${ventureId}/candidates`);
    return { ok: false, error: result.error };
  }

  redirect(`/ventures/${ventureId}/dossier/${candidateId}`);
}

export type TriggerMultiCandidateResearchResult =
  | {
      ok: true;
      successCount: number;
      failureCount: number;
      cellsWritten: number;
      unknownCount: number;
      costUsd: number;
      latencyMs: number;
      failures: { candidateId: string; error: string }[];
    }
  | { ok: false; error: string };

/**
 * M16-A2: kick off cell research across multiple candidates in one server
 * action. Returns a summary including per-candidate failures. The caller's
 * UI should surface the predictor estimate BEFORE this is called.
 */
export async function triggerMultiCandidateCellResearch(args: {
  ventureId: string;
  candidateIds: string[];
  concurrency?: number;
}): Promise<TriggerMultiCandidateResearchResult> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  const candidateIds = args.candidateIds.map((id) => id.trim()).filter(Boolean);

  if (!ventureId) return { ok: false, error: "Missing ventureId." };
  if (candidateIds.length === 0) {
    return { ok: false, error: "No candidates selected." };
  }

  const insforge = await createAuthedServerClient();
  const result = await runStage5CellResearchMulti({
    ventureId,
    candidateIds,
    insforge,
    concurrency: args.concurrency,
  });

  revalidatePath(`/ventures/${ventureId}`);
  revalidatePath(`/ventures/${ventureId}/candidates`);
  revalidatePath(`/ventures/${ventureId}/table`);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    successCount: result.successCount,
    failureCount: result.failureCount,
    cellsWritten: result.cellsWritten,
    unknownCount: result.unknownCount,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    failures: result.perCandidate
      .filter((r) => !r.ok)
      .map((r) => ({ candidateId: r.candidateId, error: r.error ?? "unknown" })),
  };
}
