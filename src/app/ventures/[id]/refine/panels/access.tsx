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

type AccessValue = VentureProfile["dimensions"]["access"];

export function AccessPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: AccessValue;
  criticFlags: CriticFlag[];
  onSave: (data: AccessValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<AccessValue>(value);
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
        title="5. Access (LRAM)"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <TextField
          label="learn"
          value={draft.learn}
          onChange={(v) => setDraft({ ...draft, learn: v })}
          multiline
          flags={flagsForField(criticFlags, "learn")}
        />
        <TextField
          label="reach"
          value={draft.reach}
          onChange={(v) => setDraft({ ...draft, reach: v })}
          multiline
          flags={flagsForField(criticFlags, "reach")}
        />
        <TextField
          label="acquire"
          value={draft.acquire}
          onChange={(v) => setDraft({ ...draft, acquire: v })}
          multiline
          flags={flagsForField(criticFlags, "acquire")}
        />
        <TextField
          label="maintain"
          value={draft.maintain}
          onChange={(v) => setDraft({ ...draft, maintain: v })}
          multiline
          flags={flagsForField(criticFlags, "maintain")}
        />
        <EnumField
          label="access_intensity"
          value={draft.access_intensity}
          options={["low", "medium", "high"] as const}
          onChange={(v) => setDraft({ ...draft, access_intensity: v })}
          flags={flagsForField(criticFlags, "access_intensity")}
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
