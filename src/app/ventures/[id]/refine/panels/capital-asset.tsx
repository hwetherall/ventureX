"use client";

import { useState, useTransition } from "react";
import type { CriticFlag, VentureProfile } from "@/types/venture-profile";
import {
  ConfidenceField,
  EnumField,
  NumberField,
  PanelHeader,
  PanelSaveButton,
  SupportingQuotesDisplay,
  TextField,
} from "../panel-primitives";
import type { SaveDimensionResult } from "../actions";

type CapitalAssetValue = VentureProfile["dimensions"]["capital_asset"];

export function CapitalAssetPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: CapitalAssetValue;
  criticFlags: CriticFlag[];
  onSave: (data: CapitalAssetValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<CapitalAssetValue>(value);
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
        title="7. Capital / Asset"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <EnumField
          label="capital_intensity"
          value={draft.capital_intensity}
          options={["low", "medium", "high"] as const}
          onChange={(v) => setDraft({ ...draft, capital_intensity: v })}
          flags={flagsForField(criticFlags, "capital_intensity")}
        />
        <EnumField
          label="asset_type"
          value={draft.asset_type}
          options={["hardware", "software", "services", "hybrid"] as const}
          onChange={(v) => setDraft({ ...draft, asset_type: v })}
          flags={flagsForField(criticFlags, "asset_type")}
        />
        <TextField
          label="manufacturing_footprint"
          value={draft.manufacturing_footprint}
          onChange={(v) => setDraft({ ...draft, manufacturing_footprint: v })}
          flags={flagsForField(criticFlags, "manufacturing_footprint")}
        />
        <TextField
          label="defensibility_model"
          value={draft.defensibility_model}
          onChange={(v) => setDraft({ ...draft, defensibility_model: v })}
          flags={flagsForField(criticFlags, "defensibility_model")}
        />
        <NumberField
          label="time_to_revenue_years"
          value={draft.time_to_revenue_years}
          onChange={(v) => setDraft({ ...draft, time_to_revenue_years: v })}
          min={0}
          max={20}
          step={1}
          flags={flagsForField(criticFlags, "time_to_revenue_years")}
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
