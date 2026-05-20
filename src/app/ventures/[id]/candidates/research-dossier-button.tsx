"use client";

import { useState, useTransition } from "react";

import { triggerCellResearch } from "../dossier/actions";

interface PredictionSummary {
  costMin: number;
  costMax: number;
  latencyMinMin: number;
  latencyMaxMin: number;
}

export function ResearchDossierButton({
  ventureId,
  candidateId,
  candidateName,
  prediction,
}: {
  ventureId: string;
  candidateId: string;
  candidateName: string;
  prediction: PredictionSummary;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const onClick = () => {
    if (isPending) return;
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await triggerCellResearch({ ventureId, candidateId });
      if (!result.ok) {
        setError(result.error);
        setShowConfirm(false);
      }
    });
  };

  const onCancel = () => {
    if (isPending) return;
    setShowConfirm(false);
  };

  const costLabel = `$${prediction.costMin.toFixed(2)} – $${prediction.costMax.toFixed(2)}`;
  const latencyLabel =
    prediction.latencyMinMin === prediction.latencyMaxMin
      ? `~${prediction.latencyMinMin} min`
      : `~${prediction.latencyMinMin}–${prediction.latencyMaxMin} min`;

  return (
    <div className="flex flex-col gap-2">
      {!showConfirm && !isPending && (
        <button
          type="button"
          onClick={onClick}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
        >
          Research dossier
        </button>
      )}

      {showConfirm && !isPending && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
          <p className="font-medium">
            Research {candidateName}'s 51-cell dossier?
          </p>
          <p className="mt-1 text-muted-foreground">
            Estimated cost: <span className="font-mono">{costLabel}</span>{" "}
            · Latency: <span className="font-mono">{latencyLabel}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClick}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
            >
              Go
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isPending && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
          <p className="font-medium">Researching {candidateName}'s dossier…</p>
          <p className="mt-1 text-muted-foreground">
            Tier 1 (15 cells) → Tier 2 (21 cells) → Tier 3 (15 cells × Exa+Sonnet).
            Page will redirect to the dossier when complete.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-[color:var(--color-error-fg)]">{error}</p>
      )}
    </div>
  );
}
