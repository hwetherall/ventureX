"use client";

import { useState, useTransition } from "react";
import type {
  CriticFlag,
  VentureProfile,
} from "@/types/venture-profile";
import {
  CriticFlagList,
  PanelHeader,
  PanelSaveButton,
  SupportingQuotesDisplay,
  TextField,
  StringArrayEditor,
  EnumField,
  ConfidenceField,
} from "../panel-primitives";
import type { SaveDimensionResult } from "../actions";

type ProductSolutionValue = VentureProfile["dimensions"]["product_solution"];

interface ProductSolutionPanelProps {
  value: ProductSolutionValue;
  criticFlags: CriticFlag[];
  onSave: (data: ProductSolutionValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}

export function ProductSolutionPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: ProductSolutionPanelProps) {
  const [draft, setDraft] = useState<ProductSolutionValue>(value);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<SaveDimensionResult | null>(
    null,
  );

  const handleSave = () => {
    startTransition(async () => {
      const result = await onSave(draft);
      setSaveResult(result);
    });
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <section className="rounded-md border border-border p-4">
      <PanelHeader
        title="1. Product / Solution"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />

      <CriticFlagList flags={criticFlags} />

      <div className="mt-6 space-y-5">
        <TextField
          label="job_to_be_done"
          value={draft.job_to_be_done}
          onChange={(v) => setDraft({ ...draft, job_to_be_done: v })}
          multiline
          flags={flagsForField(criticFlags, "job_to_be_done")}
        />
        <TextField
          label="solution_mechanism"
          value={draft.solution_mechanism}
          onChange={(v) => setDraft({ ...draft, solution_mechanism: v })}
          multiline
          flags={flagsForField(criticFlags, "solution_mechanism")}
        />
        <EnumField
          label="platform_or_pipe"
          value={draft.platform_or_pipe}
          options={["pipe", "platform", "hybrid"] as const}
          onChange={(v) => setDraft({ ...draft, platform_or_pipe: v })}
          flags={flagsForField(criticFlags, "platform_or_pipe")}
        />
        <StringArrayEditor
          label="core_features"
          values={draft.core_features}
          onChange={(arr) => setDraft({ ...draft, core_features: arr })}
          minLength={1}
          flags={flagsForField(criticFlags, "core_features")}
        />
        <StringArrayEditor
          label="substitution_landscape (load-bearing — Phase 3 reads this directly)"
          values={draft.substitution_landscape}
          onChange={(arr) => setDraft({ ...draft, substitution_landscape: arr })}
          minLength={1}
          flags={flagsForField(criticFlags, "substitution_landscape")}
          emphasis
        />
        <ConfidenceField
          value={draft.confidence}
          onChange={(v) => setDraft({ ...draft, confidence: v })}
          flags={flagsForField(criticFlags, "confidence")}
        />
        <TextField
          label="notes (optional)"
          value={draft.notes ?? ""}
          onChange={(v) =>
            setDraft({
              ...draft,
              notes: v.trim() === "" ? undefined : v,
            })
          }
          multiline
          flags={flagsForField(criticFlags, "notes")}
        />
        <SupportingQuotesDisplay quotes={draft.supporting_quotes} />
      </div>

      <PanelSaveButton
        isDirty={isDirty}
        isPending={isPending}
        wasSavedThisSession={wasSavedThisSession}
        result={saveResult}
        onSave={handleSave}
      />
    </section>
  );
}

function flagsForField(all: CriticFlag[], field: string): CriticFlag[] {
  return all.filter((f) => f.field === field);
}
