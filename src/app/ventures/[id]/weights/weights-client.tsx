"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DIMENSION_KEYS, type Dimension } from "@/types/venture-profile";
import { confirmWeights, updateDimensionWeight } from "./actions";

// ────────────────────────────────────────────────────────────────────────
// Types shared with the server component.
// ────────────────────────────────────────────────────────────────────────

export interface LatestWeight {
  dimension: Dimension;
  weight: number;
  rationale: string;
  source: "llm_proposed" | "human_adjusted";
  profileVersionId: string;
}

const SUM_TOLERANCE_LOW = 0.95;
const SUM_TOLERANCE_HIGH = 1.05;

// Snap slider input to 2 decimal places so the committed value matches
// the prompt's "2 decimal places" guidance and the eval's tolerance maths.
function snap(weight: number): number {
  return Math.round(weight * 100) / 100;
}

// ────────────────────────────────────────────────────────────────────────
// WeightsClient
// ────────────────────────────────────────────────────────────────────────

export function WeightsClient({
  ventureId,
  initialWeights,
  ventureStatus,
}: {
  ventureId: string;
  initialWeights: LatestWeight[];
  ventureStatus: string;
}) {
  const router = useRouter();
  // Map from dimension → current displayed weight. Local state so dragging
  // is responsive; commits happen on pointer-up / key-up via server action.
  const [weights, setWeights] = useState<Record<Dimension, LatestWeight>>(
    () => Object.fromEntries(initialWeights.map((w) => [w.dimension, w])) as Record<
      Dimension,
      LatestWeight
    >,
  );
  const [savingDim, setSavingDim] = useState<Dimension | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmPending, startConfirm] = useTransition();
  const isReady = ventureStatus === "ready";

  const sum = useMemo(
    () =>
      DIMENSION_KEYS.reduce((acc, dim) => acc + weights[dim].weight, 0),
    [weights],
  );

  const sumInBand = sum >= SUM_TOLERANCE_LOW && sum <= SUM_TOLERANCE_HIGH;
  const sumColor = sumInBand
    ? "text-[color:var(--color-success-fg)]"
    : "text-[color:var(--color-warning-fg)]";

  function handleLocalChange(dim: Dimension, raw: number) {
    setWeights((prev) => ({
      ...prev,
      [dim]: { ...prev[dim], weight: snap(raw) },
    }));
  }

  async function commit(dim: Dimension) {
    if (isReady) return; // Read-only after Confirm.
    const entry = weights[dim];
    setSavingDim(dim);
    try {
      const result = await updateDimensionWeight({
        ventureId,
        profileVersionId: entry.profileVersionId,
        dimension: dim,
        weight: entry.weight,
        rationale: entry.rationale,
      });
      if (!result.ok) {
        console.error("updateDimensionWeight failed:", result.error);
      } else {
        // Mark this row as human_adjusted locally so the badge updates
        // without a full server round trip.
        setWeights((prev) => ({
          ...prev,
          [dim]: { ...prev[dim], source: "human_adjusted" },
        }));
      }
    } finally {
      setSavingDim(null);
    }
  }

  function onConfirm() {
    setConfirmError(null);
    startConfirm(async () => {
      const result = await confirmWeights({ ventureId });
      if (!result.ok) {
        setConfirmError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <div className="space-y-3">
        {DIMENSION_KEYS.map((dim) => (
          <WeightBar
            key={dim}
            entry={weights[dim]}
            saving={savingDim === dim}
            disabled={isReady}
            onLocalChange={(v) => handleLocalChange(dim, v)}
            onCommit={() => void commit(dim)}
          />
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
        <div className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            Sum
          </span>
          <span className={`ml-3 font-mono tabular-nums ${sumColor}`}>
            {sum.toFixed(3)}
          </span>
          {!sumInBand && (
            <span className="ml-3 text-[color:var(--color-warning-fg)]">
              outside [{SUM_TOLERANCE_LOW}, {SUM_TOLERANCE_HIGH}]
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isReady || confirmPending || !sumInBand}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isReady
            ? "Confirmed"
            : confirmPending
              ? "Confirming…"
              : "Confirm weights"}
        </button>
      </div>

      {confirmError && (
        <p className="mt-3 text-xs text-[color:var(--color-error-fg)]">
          {confirmError}
        </p>
      )}

      {isReady && (
        <p className="mt-3 text-xs text-muted-foreground">
          Status is <code className="font-mono">ready</code>. Adjustments are
          locked. Re-run extraction from the venture page if you need to revisit.
        </p>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Single weight bar — the bar IS the slider.
// ────────────────────────────────────────────────────────────────────────

function WeightBar({
  entry,
  saving,
  disabled,
  onLocalChange,
  onCommit,
}: {
  entry: LatestWeight;
  saving: boolean;
  disabled: boolean;
  onLocalChange: (raw: number) => void;
  onCommit: () => void;
}) {
  const pct = Math.max(0, Math.min(1, entry.weight)) * 100;
  const isAdjusted = entry.source === "human_adjusted";

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      {/* Header row: dimension label + numeric value. Outside the bar so the
          text is always legible against the page background, not riding on
          the fill colour. */}
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {entry.dimension}
        </span>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {entry.weight.toFixed(2)}
        </span>
      </div>

      {/* The bar IS the slider. Click anywhere on it (or drag the invisible
          range input overlay) to adjust. Commit fires on pointer-up / key-up. */}
      <div className="relative mt-2 h-3 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-100 ease-out"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={entry.weight}
          disabled={disabled}
          onChange={(e) => onLocalChange(Number(e.target.value))}
          onPointerUp={() => onCommit()}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "Home" ||
              e.key === "End" ||
              e.key === "PageUp" ||
              e.key === "PageDown"
            ) {
              onCommit();
            }
          }}
          aria-label={`${entry.dimension} weight`}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
          {entry.rationale}
        </p>
        <span
          className={
            isAdjusted
              ? "shrink-0 rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-[color:var(--color-accent)]"
              : "shrink-0 rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-muted-foreground"
          }
        >
          {saving ? "saving…" : isAdjusted ? "human" : "llm"}
        </span>
      </div>
    </div>
  );
}
