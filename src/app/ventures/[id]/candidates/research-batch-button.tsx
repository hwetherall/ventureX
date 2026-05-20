"use client";

import { useState, useTransition } from "react";

import { triggerMultiCandidateCellResearch } from "../dossier/actions";

interface PredictionSummary {
  costMin: number;
  costMax: number;
  latencyMinMin: number;
  latencyMaxMin: number;
}

/**
 * Multi-candidate research trigger (M16-A2). The candidates page hands us
 * the pool of un-researched candidate ids; the user picks the batch size
 * (10 or "all"). Predictor estimate is rendered before the user commits.
 */
export function ResearchBatchButton({
  ventureId,
  candidateIds,
  perCandidatePrediction,
  label,
  concurrency = 3,
}: {
  ventureId: string;
  candidateIds: string[];
  perCandidatePrediction: PredictionSummary | null;
  label: string;
  concurrency?: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const n = candidateIds.length;
  // Batched cost scales linearly with candidate count. Latency scales by
  // ceil(n / concurrency) since within-batch is parallel.
  const batched = perCandidatePrediction
    ? {
        costMin: perCandidatePrediction.costMin * n,
        costMax: perCandidatePrediction.costMax * n,
        latencyMinMin: perCandidatePrediction.latencyMinMin * Math.ceil(n / concurrency),
        latencyMaxMin: perCandidatePrediction.latencyMaxMin * Math.ceil(n / concurrency),
      }
    : null;

  const onClick = () => {
    if (isPending || n === 0) return;
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await triggerMultiCandidateCellResearch({
        ventureId,
        candidateIds,
        concurrency,
      });
      if (!result.ok) {
        setError(result.error);
        setShowConfirm(false);
      }
      // On success the server action revalidates; page re-renders with the
      // candidates now researched. No client-side redirect.
    });
  };

  const onCancel = () => {
    if (isPending) return;
    setShowConfirm(false);
  };

  if (n === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No candidates need research — all dossiers exist.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!showConfirm && !isPending && (
        <button
          type="button"
          onClick={onClick}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
        >
          {label}
        </button>
      )}

      {showConfirm && !isPending && batched && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
          <p className="font-medium">
            Research {n} candidate{n === 1 ? "" : "s"} in parallel (
            {concurrency}-concurrent)?
          </p>
          <p className="mt-1 text-muted-foreground">
            Estimated cost:{" "}
            <span className="font-mono">
              ${batched.costMin.toFixed(2)} – ${batched.costMax.toFixed(2)}
            </span>{" "}
            · Latency:{" "}
            <span className="font-mono">
              {batched.latencyMinMin === batched.latencyMaxMin
                ? `~${batched.latencyMinMin} min`
                : `~${batched.latencyMinMin}–${batched.latencyMaxMin} min`}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            Per-candidate failures are logged but do not fail the batch.
            Re-run individual candidates from their dossier card after the
            run completes.
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

      {showConfirm && !isPending && !batched && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
          <p className="font-medium">Research {n} candidates?</p>
          <p className="mt-1 text-muted-foreground">
            No predictor estimate available (parameter schema not loaded).
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClick}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)]"
            >
              Go anyway
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
          <p className="font-medium">Researching {n} candidates…</p>
          <p className="mt-1 text-muted-foreground">
            {concurrency} in parallel. Don't close this tab — the orchestrator
            holds venture status in <span className="font-mono">cells_researching</span>
            until all candidates are attempted. Page refreshes when complete.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-[color:var(--color-error-fg)]">{error}</p>
      )}
    </div>
  );
}
