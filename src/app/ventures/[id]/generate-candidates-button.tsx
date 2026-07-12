"use client";

import { useState, useTransition } from "react";
import { POC_CANDIDATE_COUNT } from "@/lib/poc-scope";
import { triggerStage3Generation } from "./candidates/actions";

/**
 * @public
 * Client-side trigger for Stage 3 candidate generation.
 *
 * Belt-and-braces concurrency guard (P3-D5, client-side half):
 *   - `useTransition` flips `isPending` while the server action is in flight,
 *     so a second click resolves to a no-op until the first completes.
 *   - The server-side half lives in `runStage3Candidates`'s atomic conditional
 *     UPDATE — a parallel-tab POST that bypasses this button still gets
 *     PreconditionError rather than spending budget on a duplicate run.
 *
 * The server action calls `redirect()` on success, so the success branch of
 * the discriminated result is unreachable from this callback — only the
 * `ok: false` branch ever lands here. Errors render inline below the button.
 */
export function GenerateCandidatesButton({
  ventureId,
}: {
  ventureId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await triggerStage3Generation({ ventureId });
      // Success: server action redirected; this code is unreachable. Only
      // the failure branch executes here.
      if (!result.ok) {
        setError(result.error);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending
          ? `Generating ${POC_CANDIDATE_COUNT} candidates…`
          : `Generate exactly ${POC_CANDIDATE_COUNT} candidates`}
      </button>

      {isPending && (
        <p className="mt-2 text-xs text-muted-foreground">
          PoC run: one Direct, one Category, and one SPDM candidate. The server
          rejects any response that is not exactly {POC_CANDIDATE_COUNT} unique
          companies.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-[color:var(--color-error-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}
