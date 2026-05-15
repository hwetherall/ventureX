"use server";

import { revalidatePath } from "next/cache";
import { insertProfileVersion } from "@/lib/db/profile-versions";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage2Weighting } from "@/server/stage2-weight";
import {
  AccessSchema,
  CapitalAssetSchema,
  CurrentMaturitySchema,
  CustomersSchema,
  DIMENSION_KEYS,
  GeographyRegulatorySchema,
  IntendedEndStateSchema,
  PartnersSchema,
  ProductSolutionSchema,
  StrategicRiskSchema,
  TransactionSchema,
  VentureProfileSchema,
  type Dimension,
  type VentureProfile,
} from "@/types/venture-profile";
import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// Public discriminated result types
// ────────────────────────────────────────────────────────────────────────

export type SaveDimensionResult =
  | { ok: true; profileVersionId: string; versionNumber: number }
  | { ok: false; error: string };

export type SaveTopLevelResult = SaveDimensionResult;

/**
 * @public
 * Result of {@link confirmRefinement}. Discriminated by `ok`. The success
 * path further discriminates on `status` because the chained Stage 2 call
 * can hard-fail and transition the venture to `error` even though the
 * confirm action itself ran end-to-end.
 *
 *   - `ok: true, status: "weighting"` — confirm + Stage 2 both succeeded.
 *     7 `dimension_weights` rows now exist; venture is in `weighting`,
 *     ready for the M11 weights UI.
 *   - `ok: true, status: "error"` — confirm transitioned to weighting,
 *     Stage 2 hard-failed. Venture is now in `error` with `error_message`
 *     populated by the orchestrator. `weightingError` holds the same
 *     message for the UI to surface inline.
 *   - `ok: false` — confirm itself failed (e.g., no `human_refined` row).
 *     Venture status was not changed.
 */
export type ConfirmRefinementResult =
  | {
      ok: true;
      status: "weighting" | "error";
      weightingError?: string;
      weightRowIds?: string[];
      stage2CostUsd?: number;
    }
  | { ok: false; error: string };

// ────────────────────────────────────────────────────────────────────────
// saveDimension: replace one dimension on the latest profile_versions row,
// insert a new row with source='human_refined'.
// ────────────────────────────────────────────────────────────────────────

// Per-dimension Zod schemas keyed by dimension name so the action can pick
// the right validator from a single argument. Saves per-dimension only;
// top-level fields go through saveTopLevel below.
const DIMENSION_SCHEMAS = {
  product_solution: ProductSolutionSchema,
  customers: CustomersSchema,
  transaction: TransactionSchema,
  partners: PartnersSchema,
  access: AccessSchema,
  geography_regulatory: GeographyRegulatorySchema,
  capital_asset: CapitalAssetSchema,
} satisfies Record<Dimension, z.ZodTypeAny>;

/**
 * @public
 * Save a single dimension's edits as a new `profile_versions` row.
 *
 * Concurrency model: each call reads the latest row, applies the edit to
 * that dimension only, and inserts a new row at the next version number
 * (D6 retry-on-conflict via insertProfileVersion). This lets the user
 * save dimensions in any order without losing edits made to other
 * dimensions in earlier saves.
 *
 * The dimensionData is validated server-side against the per-dimension Zod
 * schema before the merge — never trust client-supplied JSON shape.
 */
export async function saveDimension(args: {
  ventureId: string;
  dimensionKey: Dimension;
  dimensionData: unknown;
}): Promise<SaveDimensionResult> {
  await requireUser();

  if (!DIMENSION_KEYS.includes(args.dimensionKey)) {
    return { ok: false, error: `Unknown dimension: ${args.dimensionKey}` };
  }

  const schema = DIMENSION_SCHEMAS[args.dimensionKey];
  const parsed = schema.safeParse(args.dimensionData);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Validation failed for ${args.dimensionKey}: ${parsed.error.message}`,
    };
  }

  const insforge = await createAuthedServerClient();
  const latest = await loadLatestRefinable(insforge, args.ventureId);
  if (!latest.ok) return { ok: false, error: latest.error };

  const next: VentureProfile = {
    ...latest.profile,
    dimensions: {
      ...latest.profile.dimensions,
      [args.dimensionKey]: parsed.data,
    },
  };

  // Belt-and-braces: full-profile parse before insert ensures the merged
  // row is still a valid VentureProfile (catches any latent issues in the
  // existing row that the per-dimension validator wouldn't see).
  const full = VentureProfileSchema.safeParse(next);
  if (!full.success) {
    return {
      ok: false,
      error: `Merged profile failed validation: ${full.error.message}`,
    };
  }

  try {
    const row = await insertProfileVersion(insforge, {
      ventureId: args.ventureId,
      source: "human_refined",
      profileJson: full.data,
      llmCallId: null,
    });
    revalidatePath(`/ventures/${args.ventureId}/refine`);
    return { ok: true, profileVersionId: row.id, versionNumber: row.version_number };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

// ────────────────────────────────────────────────────────────────────────
// saveTopLevel: edits to non-dimension top-level fields. Same merge pattern.
// ────────────────────────────────────────────────────────────────────────

const TopLevelEditSchema = z.object({
  synthetic_description: z.string().min(1).optional(),
  intended_end_state: IntendedEndStateSchema.optional(),
  current_maturity: CurrentMaturitySchema.optional(),
  strategic_risks_and_uncertainties: z
    .array(StrategicRiskSchema)
    .min(1)
    .max(6)
    .optional(),
  gaps_in_input: z.array(z.string().min(1)).max(5).optional(),
});

export type TopLevelEdit = z.infer<typeof TopLevelEditSchema>;

/**
 * @public
 * Save edits to top-level (non-dimension) fields. Same merge pattern as
 * saveDimension: read latest, overlay only the keys present in `edit`,
 * insert as a new `human_refined` row.
 */
export async function saveTopLevel(args: {
  ventureId: string;
  edit: TopLevelEdit;
}): Promise<SaveTopLevelResult> {
  await requireUser();

  const parsed = TopLevelEditSchema.safeParse(args.edit);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Top-level edit failed validation: ${parsed.error.message}`,
    };
  }

  const insforge = await createAuthedServerClient();
  const latest = await loadLatestRefinable(insforge, args.ventureId);
  if (!latest.ok) return { ok: false, error: latest.error };

  const next: VentureProfile = {
    ...latest.profile,
    ...parsed.data,
  };

  const full = VentureProfileSchema.safeParse(next);
  if (!full.success) {
    return {
      ok: false,
      error: `Merged profile failed validation: ${full.error.message}`,
    };
  }

  try {
    const row = await insertProfileVersion(insforge, {
      ventureId: args.ventureId,
      source: "human_refined",
      profileJson: full.data,
      llmCallId: null,
    });
    revalidatePath(`/ventures/${args.ventureId}/refine`);
    return { ok: true, profileVersionId: row.id, versionNumber: row.version_number };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

// ────────────────────────────────────────────────────────────────────────
// confirmRefinement: transition venture to 'weighting'. M10 trigger TBD.
// ────────────────────────────────────────────────────────────────────────

/**
 * @public
 * Confirm the refined profile, transition the venture into Stage 2
 * weighting, and synchronously run Stage 2.
 *
 * Guard: requires at least one `human_refined` profile_versions row, so a
 * user can't accidentally skip refinement entirely. If they want to ship
 * the LLM's first draft without edits they should save at least one
 * dimension as-is to signal explicit human acknowledgement.
 *
 * Flow:
 *   1. Verify at least one `human_refined` row exists.
 *   2. Transition `status='weighting'`.
 *   3. Call `runStage2Weighting`. The orchestrator persists 7
 *      `dimension_weights` rows on success or transitions to `status='error'`
 *      on hard failure.
 *   4. Revalidate refine + venture detail pages and return a discriminated
 *      result indicating whether Stage 2 succeeded.
 *
 * The action blocks for the full Stage 2 duration (~30-60s on a small
 * profile). Same trade-off as `triggerStage1Extraction` — synchronous keeps
 * the state machine simple and matches the user mental model of "I clicked
 * a button, I see the result."
 */
export async function confirmRefinement(args: {
  ventureId: string;
}): Promise<ConfirmRefinementResult> {
  await requireUser();
  const insforge = await createAuthedServerClient();

  const { data: refinedExists } = await insforge.database
    .from("profile_versions")
    .select("id")
    .eq("venture_id", args.ventureId)
    .eq("source", "human_refined")
    .limit(1)
    .maybeSingle();

  if (!refinedExists) {
    return {
      ok: false,
      error:
        "No human_refined profile version exists. Save at least one dimension before confirming.",
    };
  }

  const { error: transitionError } = await insforge.database
    .from("ventures")
    .update({ status: "weighting", error_message: null })
    .eq("id", args.ventureId);

  if (transitionError) {
    return {
      ok: false,
      error: `Failed to transition to weighting: ${transitionError.message}`,
    };
  }

  // Chain Stage 2. The orchestrator handles its own failure-mode status
  // transitions (status='error' with error_message stamped), so we just
  // forward the outcome into the discriminated result.
  const stage2Result = await runStage2Weighting({
    ventureId: args.ventureId,
    insforge,
  });

  revalidatePath(`/ventures/${args.ventureId}`);
  revalidatePath(`/ventures/${args.ventureId}/refine`);

  if (!stage2Result.ok) {
    return {
      ok: true,
      status: "error",
      weightingError: stage2Result.error,
    };
  }

  return {
    ok: true,
    status: "weighting",
    weightRowIds: stage2Result.weightsRowIds,
    stage2CostUsd: stage2Result.costUsd,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

type LoadResult =
  | { ok: true; profile: VentureProfile; sourceRowId: string; versionNumber: number }
  | { ok: false; error: string };

/**
 * Load the most recent profile_versions row that is editable from HITL —
 * i.e., source is `llm_extracted` or `human_refined` (not `llm_critic`,
 * which has a different shape). This is the row we merge edits onto.
 */
async function loadLatestRefinable(
  insforge: Awaited<ReturnType<typeof createAuthedServerClient>>,
  ventureId: string,
): Promise<LoadResult> {
  const { data, error } = await insforge.database
    .from("profile_versions")
    .select("id, version_number, source, profile_json")
    .eq("venture_id", ventureId)
    .in("source", ["llm_extracted", "human_refined"])
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `Failed to load latest profile: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      error: "No llm_extracted or human_refined profile_versions row found. Run Stage 1 first.",
    };
  }

  const row = data as {
    id: string;
    version_number: number;
    source: string;
    profile_json: unknown;
  };
  const parsed = VentureProfileSchema.safeParse(row.profile_json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Stored profile_versions row does not match current schema: ${parsed.error.message}`,
    };
  }

  return {
    ok: true,
    profile: parsed.data,
    sourceRowId: row.id,
    versionNumber: row.version_number,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
