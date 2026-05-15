"use client";

import type {
  CriticFlag,
  CriticSeverity,
  StrategicRisk,
  SupportingQuote,
} from "@/types/venture-profile";
import type { SaveDimensionResult } from "./actions";

/*
 * Panel primitives — shared building blocks for every dimension panel on the
 * HITL refine page. Visual contract lives in DESIGN.md §8 ("Component
 * Conventions"). Dark mode strictly paired per DESIGN.md §10 — never use a
 * Tailwind color shorthand without a `dark:` counterpart.
 */

const SEVERITY_LABEL: Record<CriticSeverity, string> = {
  weak: "Weak",
  unsupported: "Unsupported",
  over_confident: "Over-confident",
  missing_context: "Missing context",
};

// ────────────────────────────────────────────────────────────────────────
// PanelHeader — title + confidence pip + critic-flag pill
// ────────────────────────────────────────────────────────────────────────

export function PanelHeader({
  title,
  confidence,
  criticFlagCount,
}: {
  title: string;
  confidence: number;
  criticFlagCount: number;
}) {
  const confidenceLow = confidence < 0.7;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-mono ${
            confidenceLow
              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
          title={confidenceLow ? "Low confidence — review carefully" : "Confidence"}
        >
          conf {confidence.toFixed(2)}
        </span>
        {criticFlagCount > 0 && (
          <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {criticFlagCount} reviewer flag{criticFlagCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// TextField — single-line or multiline string editor with inline flag display
// ────────────────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  flags = [],
  onAcceptSuggestion,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  flags?: CriticFlag[];
  onAcceptSuggestion?: (suggested: string) => void;
}) {
  return (
    <div>
      <FieldLabel label={label} flagCount={flags.length} />
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(2, Math.ceil(value.length / 80)))}
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      )}
      <FieldFlagInline flags={flags} onAcceptSuggestion={onAcceptSuggestion} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EnumField — dropdown for closed enum values
// ────────────────────────────────────────────────────────────────────────

export function EnumField<T extends string>({
  label,
  value,
  options,
  onChange,
  flags = [],
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  flags?: CriticFlag[];
}) {
  return (
    <div>
      <FieldLabel label={label} flagCount={flags.length} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// ConfidenceField — 0.0-1.0 slider + numeric input
// ────────────────────────────────────────────────────────────────────────

export function ConfidenceField({
  value,
  onChange,
  flags = [],
}: {
  value: number;
  onChange: (v: number) => void;
  flags?: CriticFlag[];
}) {
  return (
    <div>
      <FieldLabel label="confidence (0.0–1.0)" flagCount={flags.length} />
      <div className="mt-1 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-accent"
        />
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0 && v <= 1) onChange(v);
          }}
          className="w-20 rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
        />
      </div>
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// StringArrayEditor — add/remove/edit strings.
// `loadBearing` triggers the DESIGN.md §8 emphasis treatment: 2px accent
// left rule + elevated surface. Apply only on fields CLAUDE.md §8 names
// as load-bearing (substitution_landscape, strategic_risks.implies_search_for).
// ────────────────────────────────────────────────────────────────────────

export function StringArrayEditor({
  label,
  values,
  onChange,
  minLength = 0,
  flags = [],
  loadBearing = false,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  minLength?: number;
  flags?: CriticFlag[];
  loadBearing?: boolean;
}) {
  const handleEdit = (idx: number, next: string) => {
    const copy = [...values];
    copy[idx] = next;
    onChange(copy);
  };
  const handleRemove = (idx: number) => {
    if (values.length <= minLength) return;
    onChange(values.filter((_, i) => i !== idx));
  };
  const handleAdd = () => {
    onChange([...values, ""]);
  };
  return (
    <div
      className={
        loadBearing
          ? "rounded-r border-l-2 border-accent bg-[var(--color-surface-elevated)] p-3"
          : ""
      }
    >
      <FieldLabel label={label} flagCount={flags.length} loadBearing={loadBearing} />
      <ul className="mt-2 space-y-1.5">
        {values.map((val, idx) => (
          <li key={idx} className="flex gap-2">
            <textarea
              value={val}
              onChange={(e) => handleEdit(idx, e.target.value)}
              rows={Math.min(4, Math.max(1, Math.ceil(val.length / 80)))}
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              disabled={values.length <= minLength}
              className="rounded border border-border bg-surface px-2 py-1 text-xs hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Remove this entry"
              aria-label="Remove entry"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-2 rounded border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        + Add entry
      </button>
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// NumberField — bounded numeric input. Used for time_to_revenue_years etc.
// ────────────────────────────────────────────────────────────────────────

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  flags = [],
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  flags?: CriticFlag[];
}) {
  return (
    <div>
      <FieldLabel label={label} flagCount={flags.length} />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="mt-1 w-32 rounded border border-border bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// StrategicRisksEditor — load-bearing array of {risk, implies_search_for}.
// Always rendered with the DESIGN.md §8 emphasis treatment because
// strategic_risks_and_uncertainties is one of the two load-bearing fields
// for Phase 3 candidate generation (per CLAUDE.md §8).
// Max 6 entries enforced server-side (VentureProfileSchema).
// ────────────────────────────────────────────────────────────────────────

export function StrategicRisksEditor({
  values,
  onChange,
  flags = [],
  maxLength = 6,
}: {
  values: StrategicRisk[];
  onChange: (next: StrategicRisk[]) => void;
  flags?: CriticFlag[];
  maxLength?: number;
}) {
  const handleEditField = (
    idx: number,
    field: keyof StrategicRisk,
    next: string,
  ) => {
    const copy = values.map((r, i) => (i === idx ? { ...r, [field]: next } : r));
    onChange(copy);
  };
  const handleRemove = (idx: number) => {
    if (values.length <= 1) return;
    onChange(values.filter((_, i) => i !== idx));
  };
  const handleAdd = () => {
    if (values.length >= maxLength) return;
    onChange([...values, { risk: "", implies_search_for: "" }]);
  };

  return (
    <div className="rounded-r border-l-2 border-accent bg-[var(--color-surface-elevated)] p-3">
      <FieldLabel
        label="strategic_risks_and_uncertainties"
        flagCount={flags.length}
        loadBearing
      />
      <p className="mt-1 text-xs text-muted-foreground">
        4–6 distinct risks. Each <code className="text-foreground">implies_search_for</code>{" "}
        must name a distinct class of competitor or substitute — Phase 3
        candidate generation reads this directly.
      </p>
      <ul className="mt-3 space-y-3">
        {values.map((risk, idx) => (
          <li
            key={idx}
            className="rounded border border-border bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                #{idx + 1}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                disabled={values.length <= 1}
                className="rounded border border-border bg-surface px-2 py-0.5 text-xs hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove risk"
                aria-label="Remove risk"
              >
                ×
              </button>
            </div>
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  risk
                </label>
                <textarea
                  value={risk.risk}
                  onChange={(e) => handleEditField(idx, "risk", e.target.value)}
                  rows={Math.min(4, Math.max(2, Math.ceil(risk.risk.length / 80)))}
                  className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                  implies_search_for
                </label>
                <textarea
                  value={risk.implies_search_for}
                  onChange={(e) =>
                    handleEditField(idx, "implies_search_for", e.target.value)
                  }
                  rows={Math.min(
                    4,
                    Math.max(2, Math.ceil(risk.implies_search_for.length / 80)),
                  )}
                  className="mt-1 w-full rounded border border-accent/40 bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleAdd}
        disabled={values.length >= maxLength}
        className="mt-2 rounded border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
      >
        + Add risk ({values.length}/{maxLength})
      </button>
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SupportingQuotesDisplay — read-only audit trail at the bottom of each panel
// ────────────────────────────────────────────────────────────────────────

export function SupportingQuotesDisplay({
  quotes,
}: {
  quotes: SupportingQuote[];
}) {
  if (quotes.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Supporting quotes ({quotes.length})
      </h3>
      <ul className="mt-2 space-y-2">
        {quotes.map((q, i) => (
          <li
            key={i}
            className="rounded border-l-2 border-border bg-muted/40 px-3 py-2 text-xs"
          >
            <p className="italic text-foreground">&ldquo;{q.quote}&rdquo;</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              — {q.source}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// PanelSaveButton — DESIGN.md §9 always-active save with two visual states.
// Unchanged: "Mark reviewed" (secondary). Dirty: "Save dimension" (primary).
// Both create human_refined audit rows.
// ────────────────────────────────────────────────────────────────────────

export function PanelSaveButton({
  isDirty,
  isPending,
  wasSavedThisSession,
  result,
  onSave,
}: {
  isDirty: boolean;
  isPending: boolean;
  wasSavedThisSession: boolean;
  result: SaveDimensionResult | null;
  onSave: () => void;
}) {
  const label = isPending
    ? isDirty
      ? "Saving…"
      : "Marking…"
    : isDirty
      ? "Save dimension"
      : "Mark reviewed";

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className={
          isDirty
            ? "rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
            : "rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        }
        title={
          isDirty
            ? "Save your edits as a new human_refined version"
            : "Create a human_refined version with no changes — signals you reviewed and approved as-is"
        }
      >
        {label}
      </button>
      {wasSavedThisSession && !isDirty && !isPending && result && result.ok && (
        <span className="text-xs text-[color:var(--color-success-fg)]">
          v{result.versionNumber} saved
        </span>
      )}
      {result && !result.ok && (
        <span className="text-xs text-[color:var(--color-error-fg)]">
          {result.error}
        </span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Small internals
// ────────────────────────────────────────────────────────────────────────

function FieldLabel({
  label,
  flagCount,
  loadBearing = false,
}: {
  label: string;
  flagCount: number;
  loadBearing?: boolean;
}) {
  return (
    <label className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span className={loadBearing ? "text-foreground" : ""}>{label}</span>
      {loadBearing && (
        <span
          className="rounded px-1.5 py-0 text-[10px] normal-case tracking-normal text-accent"
          title="Load-bearing field — Phase 3 candidate generation reads this directly"
        >
          load-bearing
        </span>
      )}
      {flagCount > 0 && (
        <span className="rounded bg-amber-50 px-1.5 py-0 font-mono text-[10px] normal-case text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {flagCount} flag
        </span>
      )}
    </label>
  );
}

function FieldFlagInline({
  flags,
  onAcceptSuggestion,
}: {
  flags: CriticFlag[];
  onAcceptSuggestion?: (suggested: string) => void;
}) {
  if (flags.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {flags.map((f, i) => (
        <li
          key={i}
          className="rounded border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] px-2 py-1 text-[color:var(--color-warning-fg)]"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">
              <span className="font-medium">[{SEVERITY_LABEL[f.severity]}]</span>{" "}
              {f.comment}
            </span>
            {onAcceptSuggestion && (
              <button
                type="button"
                onClick={() => onAcceptSuggestion(f.comment)}
                className="shrink-0 rounded border border-current px-1.5 py-0.5 text-[10px] font-medium hover:bg-current/10"
                title="Use the critic's wording as the field value"
              >
                Accept text
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
