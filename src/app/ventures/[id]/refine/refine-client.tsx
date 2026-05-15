"use client";

import { useState, useTransition } from "react";
import type {
  CriticFlag,
  Dimension,
  Stage1CriticOutput,
  VentureProfile,
} from "@/types/venture-profile";
import {
  confirmRefinement,
  saveDimension,
  saveTopLevel,
  type ConfirmRefinementResult,
  type SaveDimensionResult,
  type SaveTopLevelResult,
  type TopLevelEdit,
} from "./actions";
import { ProductSolutionPanel } from "./panels/product-solution";

interface RefineClientProps {
  ventureId: string;
  initialProfile: VentureProfile;
  critic: Stage1CriticOutput | null;
  ventureDescription: string;
  ventureStatus: string;
}

export function RefineClient(props: RefineClientProps) {
  const { ventureId, initialProfile, critic, ventureStatus } = props;
  const [profile, setProfile] = useState<VentureProfile>(initialProfile);
  const [savedDimensions, setSavedDimensions] = useState<Set<Dimension>>(
    new Set(),
  );
  const [savedTopLevel, setSavedTopLevel] = useState(false);
  const [confirmState, setConfirmState] = useState<
    | { status: "idle" }
    | { status: "pending" }
    | { status: "error"; error: string }
  >({ status: "idle" });
  const [isConfirming, startConfirmTransition] = useTransition();

  // Per-dimension save handler. Optimistically updates local state on success
  // and marks the dimension as saved-this-session for UI affordance.
  const handleSaveDimension = async (
    dimensionKey: Dimension,
    dimensionData: VentureProfile["dimensions"][Dimension],
  ): Promise<SaveDimensionResult> => {
    const result = await saveDimension({
      ventureId,
      dimensionKey,
      dimensionData,
    });
    if (result.ok) {
      setProfile((p) => ({
        ...p,
        dimensions: { ...p.dimensions, [dimensionKey]: dimensionData },
      }));
      setSavedDimensions((s) => new Set(s).add(dimensionKey));
    }
    return result;
  };

  const handleSaveTopLevel = async (
    edit: TopLevelEdit,
  ): Promise<SaveTopLevelResult> => {
    const result = await saveTopLevel({ ventureId, edit });
    if (result.ok) {
      setProfile((p) => ({ ...p, ...edit }));
      setSavedTopLevel(true);
    }
    return result;
  };

  const onConfirm = () => {
    startConfirmTransition(async () => {
      setConfirmState({ status: "pending" });
      const result: ConfirmRefinementResult = await confirmRefinement({
        ventureId,
      });
      if (!result.ok) {
        setConfirmState({ status: "error", error: result.error });
        return;
      }
      // Page revalidation in the action redirects naturally; nothing else to do.
      setConfirmState({ status: "idle" });
    });
  };

  const alreadyPastRefine =
    ventureStatus === "weighting" || ventureStatus === "ready";

  return (
    <div className="mt-8 space-y-10">
      <ProductSolutionPanel
        value={profile.dimensions.product_solution}
        criticFlags={criticFlagsFor(critic, "product_solution")}
        onSave={(data) => handleSaveDimension("product_solution", data)}
        wasSavedThisSession={savedDimensions.has("product_solution")}
      />

      {/* M9.4 will plug the other 6 dimension panels here, in CLAUDE.md §10 order. */}
      <section className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        Remaining dimension panels (customers, transaction, partners, access,
        geography_regulatory, capital_asset) plus the top-level panel
        (synthetic_description, intended_end_state, current_maturity,
        strategic_risks, gaps_in_input) will land in M9.4. Editing is
        functional for product_solution today; this section is a placeholder.
      </section>

      <section className="rounded-md border border-border p-4 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirm refinement
        </h2>
        <p className="mt-2 text-muted-foreground">
          When you&apos;re done editing dimensions, click below to transition
          the venture to Stage 2 weighting. At least one dimension must have
          been saved as <code>human_refined</code> first.
        </p>
        {alreadyPastRefine && (
          <p className="mt-2 rounded bg-muted p-2 text-xs">
            This venture is already past refinement (status:{" "}
            <code>{ventureStatus}</code>). Confirming again is a no-op.
          </p>
        )}
        {confirmState.status === "error" && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
            {confirmState.error}
          </p>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={isConfirming || alreadyPastRefine}
          className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
        >
          {isConfirming
            ? "Confirming…"
            : alreadyPastRefine
              ? "Already confirmed"
              : "Confirm and continue to weighting"}
        </button>
        {savedTopLevel === false &&
          savedDimensions.size === 0 &&
          !alreadyPastRefine && (
            <p className="mt-2 text-xs text-muted-foreground">
              No dimensions saved yet this session.
            </p>
          )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Pull the critic flags for a single dimension, or an empty array if the
 * critic didn't run or didn't flag this dimension. Used by every panel.
 */
function criticFlagsFor(
  critic: Stage1CriticOutput | null,
  dimensionKey: Dimension,
): CriticFlag[] {
  if (!critic) return [];
  const dimension = critic.per_dimension[dimensionKey];
  return dimension?.flags ?? [];
}
