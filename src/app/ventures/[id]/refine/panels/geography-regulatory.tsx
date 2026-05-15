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

type GeographyValue = VentureProfile["dimensions"]["geography_regulatory"];

export function GeographyRegulatoryPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: GeographyValue;
  criticFlags: CriticFlag[];
  onSave: (data: GeographyValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<GeographyValue>(value);
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
        title="6. Geography & Regulatory"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <StringArrayEditor
          label="target_geographies"
          values={draft.target_geographies}
          onChange={(arr) => setDraft({ ...draft, target_geographies: arr })}
          flags={flagsForField(criticFlags, "target_geographies")}
        />
        <StringArrayEditor
          label="accessible_market_constraints"
          values={draft.accessible_market_constraints}
          onChange={(arr) =>
            setDraft({ ...draft, accessible_market_constraints: arr })
          }
          flags={flagsForField(criticFlags, "accessible_market_constraints")}
        />
        <EnumField
          label="regulatory_regime"
          value={draft.regulatory_regime}
          options={["Light", "Medium", "Heavy"] as const}
          onChange={(v) => setDraft({ ...draft, regulatory_regime: v })}
          flags={flagsForField(criticFlags, "regulatory_regime")}
        />
        <StringArrayEditor
          label="localization_requirements"
          values={draft.localization_requirements}
          onChange={(arr) =>
            setDraft({ ...draft, localization_requirements: arr })
          }
          flags={flagsForField(criticFlags, "localization_requirements")}
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
