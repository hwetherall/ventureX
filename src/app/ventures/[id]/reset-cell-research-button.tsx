"use client";

import { useState, useTransition } from "react";

import { resetCellResearch } from "./dossier/actions";

/**
 * Admin button: wipe cells + exa_call_logs and reset venture status back to
 * `parameters_ready`. Two-step confirmation so a stray click doesn't blow
 * away an hour of research.
 */
export function ResetCellResearchButton({
  ventureId,
}: {
  ventureId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onClick = () => {
    if (isPending) return;
    if (!showConfirm) {
      setShowConfirm(true);
      setError(null);
      setSuccess(null);
      return;
    }
    startTransition(async () => {
      const result = await resetCellResearch({ ventureId });
      if (!result.ok) {
        setError(result.error);
        setShowConfirm(false);
        return;
      }
      setSuccess(
        `Reset complete. Deleted ${result.cellsDeleted} cells and ${result.exaLogsDeleted} Exa call logs. Venture status returned to parameters_ready.`,
      );
      setShowConfirm(false);
    });
  };

  const onCancel = () => {
    if (isPending) return;
    setShowConfirm(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {!showConfirm && !isPending && (
        <button
          type="button"
          onClick={onClick}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--color-error-bg)] hover:text-[color:var(--color-error-fg)]"
        >
          Reset cell research
        </button>
      )}

      {showConfirm && !isPending && (
        <div className="rounded-md border border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] p-3 text-xs">
          <p className="font-medium text-[color:var(--color-error-fg)]">
            Delete all cells + exa_call_logs for this venture?
          </p>
          <p className="mt-1 text-muted-foreground">
            This wipes every dossier's worth of research and flips status back
            to <span className="font-mono">parameters_ready</span>. The
            candidate set + parameter schema are preserved. Cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClick}
              className="rounded-md bg-[color:var(--color-error-fg)] px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              Yes, reset
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isPending && (
        <p className="text-xs text-muted-foreground">
          Wiping cells + exa logs…
        </p>
      )}

      {success && (
        <p className="text-xs text-[color:var(--color-success-fg)]">
          {success}
        </p>
      )}

      {error && (
        <p className="text-xs text-[color:var(--color-error-fg)]">{error}</p>
      )}
    </div>
  );
}
