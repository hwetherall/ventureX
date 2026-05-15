"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { DIMENSION_KEYS, type Dimension } from "@/types/venture-profile";

const SUM_TOLERANCE_LOW = 0.95;
const SUM_TOLERANCE_HIGH = 1.05;

const RATIONALE_MAX = 500;

// ────────────────────────────────────────────────────────────────────────
// updateDimensionWeight
// ────────────────────────────────────────────────────────────────────────

export type UpdateWeightResult =
  | { ok: true; rowId: string }
  | { ok: false; error: string };

/**
 * @public
 * Insert a new `dimension_weights` row with `source='human_adjusted'`.
 *
 * Per CLAUDE.md §11: user adjustments insert (never UPDATE). The latest
 * row per (venture, dimension) is canonical — readers query for the most
 * recent by `created_at` when rendering.
 *
 * Called on slider release (`onPointerUp` / `onKeyUp`) from the client.
 * The rationale string is carried forward from the LLM's proposed row
 * unless the user has explicitly edited it (future ticket; V1 keeps
 * the LLM rationale).
 */
export async function updateDimensionWeight(args: {
  ventureId: string;
  profileVersionId: string;
  dimension: Dimension;
  weight: number;
  rationale: string;
}): Promise<UpdateWeightResult> {
  await requireUser();

  if (!DIMENSION_KEYS.includes(args.dimension)) {
    return { ok: false, error: `Unknown dimension: ${args.dimension}` };
  }
  if (
    !Number.isFinite(args.weight) ||
    args.weight < 0 ||
    args.weight > 1
  ) {
    return {
      ok: false,
      error: `Weight must be a number in [0, 1]; got ${args.weight}`,
    };
  }
  const rationale = args.rationale.trim();
  if (rationale.length === 0 || rationale.length > RATIONALE_MAX) {
    return {
      ok: false,
      error: `Rationale must be 1-${RATIONALE_MAX} chars; got ${rationale.length}`,
    };
  }

  const insforge = await createAuthedServerClient();
  const { data, error } = await insforge.database
    .from("dimension_weights")
    .insert([
      {
        venture_id: args.ventureId,
        profile_version_id: args.profileVersionId,
        dimension: args.dimension,
        weight: args.weight,
        rationale,
        source: "human_adjusted",
      },
    ])
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: `Failed to insert dimension_weights row: ${error?.message ?? "no row returned"}`,
    };
  }

  revalidatePath(`/ventures/${args.ventureId}/weights`);
  return { ok: true, rowId: (data as { id: string }).id };
}

// ────────────────────────────────────────────────────────────────────────
// confirmWeights
// ────────────────────────────────────────────────────────────────────────

export type ConfirmWeightsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * @public
 * Transition the venture to `status='ready'` after the user has reviewed
 * and confirmed the weights. CLAUDE.md §11 puts this transition on the
 * Confirm button at the bottom of the weights UI.
 *
 * Sanity check: load the latest weight per dimension, confirm the sum is
 * within [0.95, 1.05]. Outside that band we refuse — better to surface
 * "your weights don't sum to 1.0" than to ship a malformed weighting
 * downstream. The client UI should keep the Confirm button disabled if
 * the running sum is outside this band, but this is the server-side
 * belt-and-braces.
 */
export async function confirmWeights(args: {
  ventureId: string;
}): Promise<ConfirmWeightsResult> {
  await requireUser();
  const insforge = await createAuthedServerClient();

  // Pull the latest weight per dimension. InsForge doesn't have window
  // functions in the JS query builder, so we do it in app code: select
  // all rows for the venture, sort by created_at desc, take the first
  // hit per dimension.
  const { data: rows, error: readError } = await insforge.database
    .from("dimension_weights")
    .select("dimension, weight, created_at")
    .eq("venture_id", args.ventureId)
    .order("created_at", { ascending: false });

  if (readError) {
    return {
      ok: false,
      error: `Failed to load dimension_weights: ${readError.message}`,
    };
  }

  type Row = { dimension: Dimension; weight: number; created_at: string };
  const latestPerDim = new Map<Dimension, number>();
  for (const row of (rows ?? []) as Row[]) {
    if (!latestPerDim.has(row.dimension)) {
      latestPerDim.set(row.dimension, row.weight);
    }
  }

  if (latestPerDim.size !== DIMENSION_KEYS.length) {
    const missing = DIMENSION_KEYS.filter((d) => !latestPerDim.has(d));
    return {
      ok: false,
      error: `Missing weights for: ${missing.join(", ")}. Run Stage 2 weighting first.`,
    };
  }

  const sum = DIMENSION_KEYS.reduce(
    (acc, dim) => acc + (latestPerDim.get(dim) ?? 0),
    0,
  );

  if (sum < SUM_TOLERANCE_LOW || sum > SUM_TOLERANCE_HIGH) {
    return {
      ok: false,
      error: `Weights sum to ${sum.toFixed(3)}, outside tolerance [${SUM_TOLERANCE_LOW}, ${SUM_TOLERANCE_HIGH}]. Adjust before confirming.`,
    };
  }

  const { error: updateError } = await insforge.database
    .from("ventures")
    .update({ status: "ready", error_message: null })
    .eq("id", args.ventureId);

  if (updateError) {
    return {
      ok: false,
      error: `Failed to transition status to 'ready': ${updateError.message}`,
    };
  }

  revalidatePath(`/ventures/${args.ventureId}`);
  revalidatePath(`/ventures/${args.ventureId}/weights`);
  return { ok: true };
}
