"use client";

import { useState, useTransition } from "react";
import type { CriticFlag, VentureProfile } from "@/types/venture-profile";
import {
  ConfidenceField,
  PanelHeader,
  PanelSaveButton,
  StringArrayEditor,
  SupportingQuotesDisplay,
  TextField,
} from "../panel-primitives";
import type { SaveDimensionResult } from "../actions";

type PartnersValue = VentureProfile["dimensions"]["partners"];

export function PartnersPanel({
  value,
  criticFlags,
  onSave,
  wasSavedThisSession,
}: {
  value: PartnersValue;
  criticFlags: CriticFlag[];
  onSave: (data: PartnersValue) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const [draft, setDraft] = useState<PartnersValue>(value);
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
        title="4. Partners"
        confidence={draft.confidence}
        criticFlagCount={criticFlags.length}
      />
      <div className="mt-6 space-y-5">
        <StringArrayEditor
          label="distribution_channels"
          values={draft.distribution_channels}
          onChange={(arr) => setDraft({ ...draft, distribution_channels: arr })}
          flags={flagsForField(criticFlags, "distribution_channels")}
        />
        <StringArrayEditor
          label="key_suppliers"
          values={draft.key_suppliers}
          onChange={(arr) => setDraft({ ...draft, key_suppliers: arr })}
          flags={flagsForField(criticFlags, "key_suppliers")}
        />
        <StringArrayEditor
          label="regulators_certifications"
          values={draft.regulators_certifications}
          onChange={(arr) =>
            setDraft({ ...draft, regulators_certifications: arr })
          }
          flags={flagsForField(criticFlags, "regulators_certifications")}
        />
        <StringArrayEditor
          label="system_integrators_resellers"
          values={draft.system_integrators_resellers}
          onChange={(arr) =>
            setDraft({ ...draft, system_integrators_resellers: arr })
          }
          flags={flagsForField(criticFlags, "system_integrators_resellers")}
        />
        <StringArrayEditor
          label="complementary_product_partners"
          values={draft.complementary_product_partners}
          onChange={(arr) =>
            setDraft({ ...draft, complementary_product_partners: arr })
          }
          flags={flagsForField(criticFlags, "complementary_product_partners")}
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
