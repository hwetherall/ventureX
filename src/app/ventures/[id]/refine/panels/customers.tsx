"use client";

import { useState, useTransition } from "react";
import type { CriticFlag, VentureProfile } from "@/types/venture-profile";
import {
  ConfidenceField,
  EnumField,
  PanelHeader,
  PanelSaveButton,
  StringArrayEditor,
  SupportingQuotesDisplay,
  TextField,
} from "../panel-primitives";
import type { SaveDimensionResult } from "../actions";

type CustomersValue = VentureProfile["dimensions"]["customers"];

export function CustomersPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: CustomersValue;
  criticFlags: CriticFlag[];
  onSave: (data: CustomersValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<CustomersValue>(value);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<SaveDimensionResult | null>(
    null,
  );

  const handleSave = () =>
    startTransition(async () => {
      const result = await onSave(draft);
      setSaveResult(result);
    });

  const isDirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <PanelHeader
        title="2. Customers"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <EnumField
          label="segment_type"
          value={draft.segment_type}
          options={["B2C", "B2B-SME", "B2B-Enterprise", "B2G", "mixed"] as const}
          onChange={(v) => setDraft({ ...draft, segment_type: v })}
          flags={flagsForField(criticFlags, "segment_type")}
        />
        <TextField
          label="buyer"
          value={draft.buyer}
          onChange={(v) => setDraft({ ...draft, buyer: v })}
          multiline
          flags={flagsForField(criticFlags, "buyer")}
        />
        <TextField
          label="user"
          value={draft.user}
          onChange={(v) => setDraft({ ...draft, user: v })}
          multiline
          flags={flagsForField(criticFlags, "user")}
        />
        <StringArrayEditor
          label="target_sub_segments"
          values={draft.target_sub_segments}
          onChange={(arr) => setDraft({ ...draft, target_sub_segments: arr })}
          flags={flagsForField(criticFlags, "target_sub_segments")}
        />
        <EnumField
          label="buyer_sophistication"
          value={draft.buyer_sophistication}
          options={["low", "medium", "high"] as const}
          onChange={(v) => setDraft({ ...draft, buyer_sophistication: v })}
          flags={flagsForField(criticFlags, "buyer_sophistication")}
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
            setDraft({ ...draft, notes: v.trim() === "" ? undefined : v })
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
