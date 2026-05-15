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
import { AccessPanel } from "./panels/access";
import { CapitalAssetPanel } from "./panels/capital-asset";
import { CustomersPanel } from "./panels/customers";
import { GeographyRegulatoryPanel } from "./panels/geography-regulatory";
import { PartnersPanel } from "./panels/partners";
import { ProductSolutionPanel } from "./panels/product-solution";
import { TopLevelPanel } from "./panels/top-level";
import { TransactionPanel } from "./panels/transaction";

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
    | { status: "success"; weightsCount: number }
    | { status: "weighting_failed"; error: string }
    | { status: "error"; error: string }
  >({ status: "idle" });
  const [isConfirming, startConfirmTransition] = useTransition();

  const handleSaveDimension = async <K extends Dimension>(
    dimensionKey: K,
    dimensionData: VentureProfile["dimensions"][K],
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
      if (result.status === "error") {
        setConfirmState({
          status: "weighting_failed",
          error: result.weightingError ?? "Stage 2 failed for an unknown reason.",
        });
        return;
      }
      setConfirmState({
        status: "success",
        weightsCount: result.weightRowIds?.length ?? 7,
      });
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

      <CustomersPanel
        value={profile.dimensions.customers}
        criticFlags={criticFlagsFor(critic, "customers")}
        onSave={(data) => handleSaveDimension("customers", data)}
        wasSavedThisSession={savedDimensions.has("customers")}
      />

      <TransactionPanel
        value={profile.dimensions.transaction}
        criticFlags={criticFlagsFor(critic, "transaction")}
        onSave={(data) => handleSaveDimension("transaction", data)}
        wasSavedThisSession={savedDimensions.has("transaction")}
      />

      <PartnersPanel
        value={profile.dimensions.partners}
        criticFlags={criticFlagsFor(critic, "partners")}
        onSave={(data) => handleSaveDimension("partners", data)}
        wasSavedThisSession={savedDimensions.has("partners")}
      />

      <AccessPanel
        value={profile.dimensions.access}
        criticFlags={criticFlagsFor(critic, "access")}
        onSave={(data) => handleSaveDimension("access", data)}
        wasSavedThisSession={savedDimensions.has("access")}
      />

      <GeographyRegulatoryPanel
        value={profile.dimensions.geography_regulatory}
        criticFlags={criticFlagsFor(critic, "geography_regulatory")}
        onSave={(data) => handleSaveDimension("geography_regulatory", data)}
        wasSavedThisSession={savedDimensions.has("geography_regulatory")}
      />

      <CapitalAssetPanel
        value={profile.dimensions.capital_asset}
        criticFlags={criticFlagsFor(critic, "capital_asset")}
        onSave={(data) => handleSaveDimension("capital_asset", data)}
        wasSavedThisSession={savedDimensions.has("capital_asset")}
      />

      <TopLevelPanel
        profile={profile}
        onSave={handleSaveTopLevel}
        wasSavedThisSession={savedTopLevel}
      />

      <section className="rounded-md border border-border bg-surface p-4 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirm refinement
        </h2>
        <p className="mt-2 text-muted-foreground">
          When you&apos;re done editing dimensions, click below to transition
          the venture to Stage 2 weighting. At least one dimension must have
          been saved as <code>human_refined</code> first. Stage 2 runs
          synchronously after the transition — expect ~30-60 seconds.
        </p>
        {alreadyPastRefine && (
          <p className="mt-2 rounded bg-muted p-2 text-xs">
            This venture is already past refinement (status:{" "}
            <code>{ventureStatus}</code>). Confirming again is a no-op.
          </p>
        )}
        {confirmState.status === "error" && (
          <p className="mt-2 rounded border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-2 text-xs text-[color:var(--color-error-fg)]">
            Confirm failed: {confirmState.error}
          </p>
        )}
        {confirmState.status === "weighting_failed" && (
          <p className="mt-2 rounded border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-2 text-xs text-[color:var(--color-error-fg)]">
            Stage 2 weighting failed: {confirmState.error} You can click
            below again to retry; refinement saves are still intact.
          </p>
        )}
        {confirmState.status === "success" && (
          <p className="mt-2 rounded border border-border bg-muted/40 p-2 text-xs text-[color:var(--color-success-fg)]">
            Stage 2 complete — {confirmState.weightsCount} dimension weights
            persisted. The weights UI (M11) will surface them next.
          </p>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={isConfirming || alreadyPastRefine}
          className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isConfirming
            ? "Confirming + running Stage 2…"
            : alreadyPastRefine
              ? "Already confirmed"
              : confirmState.status === "weighting_failed"
                ? "Retry Stage 2"
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

function criticFlagsFor(
  critic: Stage1CriticOutput | null,
  dimensionKey: Dimension,
): CriticFlag[] {
  if (!critic) return [];
  const dimension = critic.per_dimension[dimensionKey];
  return dimension?.flags ?? [];
}
