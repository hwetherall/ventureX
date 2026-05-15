"use client";

import { useState, useTransition } from "react";
import type { CriticFlag, VentureProfile } from "@/types/venture-profile";
import {
  ConfidenceField,
  EnumField,
  PanelHeader,
  PanelSaveButton,
  SupportingQuotesDisplay,
  TextField,
} from "../panel-primitives";
import type { SaveDimensionResult } from "../actions";

type TransactionValue = VentureProfile["dimensions"]["transaction"];

export function TransactionPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: TransactionValue;
  criticFlags: CriticFlag[];
  onSave: (data: TransactionValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<TransactionValue>(value);
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
        title="3. Transaction"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <EnumField
          label="model"
          value={draft.model}
          options={
            [
              "unit_sales",
              "subscription",
              "licensing",
              "commission",
              "fee_for_service",
              "advertising",
              "rental",
              "hybrid",
            ] as const
          }
          onChange={(v) => setDraft({ ...draft, model: v })}
          flags={flagsForField(criticFlags, "model")}
        />
        <TextField
          label="typical_deal_size_usd"
          value={draft.typical_deal_size_usd}
          onChange={(v) => setDraft({ ...draft, typical_deal_size_usd: v })}
          multiline
          flags={flagsForField(criticFlags, "typical_deal_size_usd")}
        />
        <EnumField
          label="margin_profile"
          value={draft.margin_profile}
          options={["low", "medium", "high"] as const}
          onChange={(v) => setDraft({ ...draft, margin_profile: v })}
          flags={flagsForField(criticFlags, "margin_profile")}
        />
        <EnumField
          label="revenue_recurrence"
          value={draft.revenue_recurrence}
          options={["one_time", "recurring", "mixed"] as const}
          onChange={(v) => setDraft({ ...draft, revenue_recurrence: v })}
          flags={flagsForField(criticFlags, "revenue_recurrence")}
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
