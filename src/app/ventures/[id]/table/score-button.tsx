"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { triggerCandidateScoring } from "./actions";

/**
 * Toolbar trigger for Stage 6 evidence-based scoring. Scores every candidate
 * that has enough researched cells, then the table re-renders ranked by
 * weighted aggregate. Lives in the table toolbar because scoring is a
 * property of the comparison table, not a pipeline stage gate.
 */
export function ScoreCandidatesButton({
  ventureId,
  researchedCount,
  hasScores,
}: {
  ventureId: string;
  researchedCount: number;
  hasScores: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (isPending) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await triggerCandidateScoring({ ventureId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const skippedPart =
        result.skippedCount > 0
          ? ` · ${result.skippedCount} skipped (insufficient research)`
          : "";
      const failedPart =
        result.failedCount > 0 ? ` · ${result.failedCount} failed` : "";
      setMessage(`Scored ${result.scoredCount}${skippedPart}${failedPart}`);
      router.refresh();
    });
  };

  const idleLabel = hasScores ? "Re-score & rank" : "Score & rank";

  return (
    <span className="vx-score-action">
      <button
        type="button"
        className="vx-secondary-button"
        onClick={onClick}
        disabled={isPending || researchedCount === 0}
        title={
          researchedCount === 0
            ? "No candidate has researched cells yet — run cell research first"
            : `Score the ${researchedCount} researched candidate(s) against the venture's weighted dimensions`
        }
      >
        {isPending ? `Scoring ${researchedCount} candidates…` : idleLabel}
      </button>
      {message && <span className="vx-corner-meta">{message}</span>}
      {error && (
        <span className="vx-corner-meta" style={{ color: "var(--vx-error)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
