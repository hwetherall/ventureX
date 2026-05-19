"use client";

import { useState, useTransition } from "react";
import { triggerParameterGeneration } from "./parameters/actions";

export function GenerateParametersButton({
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
      const result = await triggerParameterGeneration({ ventureId });
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
        {isPending ? "Generating parameters..." : "Generate parameters"}
      </button>

      {isPending && (
        <p className="mt-2 text-xs text-muted-foreground">
          Building the Y-axis schema from the profile and accepted weights.
          Redirects to the parameter list when complete.
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
