"use client";

import { useState } from "react";
import type {
  CriticFlag,
  CriticSeverity,
  SupportingQuote,
} from "@/types/venture-profile";
import type { SaveDimensionResult } from "./actions";

// ────────────────────────────────────────────────────────────────────────
// PanelHeader — title + confidence badge + critic flag count
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
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-mono ${
            confidenceLow
              ? "bg-amber-100 text-amber-900"
              : "bg-muted text-foreground"
          }`}
          title={confidenceLow ? "Low confidence" : "Confidence"}
        >
          conf {confidence.toFixed(2)}
        </span>
        {criticFlagCount > 0 && (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
            {criticFlagCount} reviewer flag{criticFlagCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CriticFlagList — collapsible "Reviewer notes" block at panel top
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<CriticSeverity, string> = {
  weak: "Weak",
  unsupported: "Unsupported",
  over_confident: "Over-confident",
  missing_context: "Missing context",
};

export function CriticFlagList({ flags }: { flags: CriticFlag[] }) {
  const [open, setOpen] = useState(false);
  if (flags.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-amber-900 underline underline-offset-4 hover:no-underline"
      >
        {open ? "Hide" : "Show"} reviewer notes ({flags.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
          {flags.map((f, i) => (
            <li key={i} className="text-amber-950">
              <span className="font-medium">[{SEVERITY_LABEL[f.severity]}]</span>{" "}
              <code className="font-mono">{f.field}</code>: {f.comment}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// TextField — single-line or multiline string editor with field-level flag pip
// ────────────────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  flags = [],
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  flags?: CriticFlag[];
}) {
  return (
    <div>
      <FieldLabel label={label} flagCount={flags.length} />
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(2, Math.ceil(value.length / 80)))}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />
      )}
      <FieldFlagInline flags={flags} />
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
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
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
// ConfidenceField — 0.0-1.0 slider (visual) + numeric input (precise)
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
          className="flex-1"
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
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
        />
      </div>
      <FieldFlagInline flags={flags} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// StringArrayEditor — add/remove/edit strings. Used for core_features,
// substitution_landscape (load-bearing), target_geographies, etc.
// ────────────────────────────────────────────────────────────────────────

export function StringArrayEditor({
  label,
  values,
  onChange,
  minLength = 0,
  flags = [],
  emphasis = false,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  minLength?: number;
  flags?: CriticFlag[];
  emphasis?: boolean;
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
        emphasis
          ? "rounded-md border border-foreground/30 bg-foreground/5 p-3"
          : ""
      }
    >
      <FieldLabel label={label} flagCount={flags.length} />
      <ul className="mt-2 space-y-1.5">
        {values.map((val, idx) => (
          <li key={idx} className="flex gap-2">
            <textarea
              value={val}
              onChange={(e) => handleEdit(idx, e.target.value)}
              rows={Math.min(4, Math.max(1, Math.ceil(val.length / 80)))}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              disabled={values.length <= minLength}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-30"
              title="Remove this entry"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-2 rounded-md border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        + Add entry
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
            className="rounded border-l-2 border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs"
          >
            <p className="italic">&ldquo;{q.quote}&rdquo;</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              — {q.source}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// PanelSaveButton — pending / dirty / saved state, with error display
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
  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || isPending}
        className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
      >
        {isPending ? "Saving…" : "Save dimension"}
      </button>
      {!isDirty && wasSavedThisSession && (
        <span className="text-xs text-green-700">Saved this session</span>
      )}
      {result && !result.ok && (
        <span className="text-xs text-red-700">{result.error}</span>
      )}
      {result && result.ok && isPending === false && !isDirty && (
        <span className="text-xs text-green-700">
          v{result.versionNumber} saved
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
}: {
  label: string;
  flagCount: number;
}) {
  return (
    <label className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      {flagCount > 0 && (
        <span className="rounded bg-amber-100 px-1.5 py-0 font-mono text-[10px] normal-case text-amber-900">
          {flagCount} flag
        </span>
      )}
    </label>
  );
}

function FieldFlagInline({ flags }: { flags: CriticFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs text-amber-900">
      {flags.map((f, i) => (
        <li key={i}>
          <span className="font-medium">[{SEVERITY_LABEL[f.severity]}]</span>{" "}
          {f.comment}
        </li>
      ))}
    </ul>
  );
}
