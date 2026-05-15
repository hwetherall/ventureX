"use client";

import { useState, useTransition } from "react";
import type {
  IntendedEndState,
  StrategicRisk,
  VentureProfile,
} from "@/types/venture-profile";
import {
  EnumField,
  PanelSaveButton,
  StrategicRisksEditor,
  StringArrayEditor,
  TextField,
} from "../panel-primitives";
import type { SaveDimensionResult, TopLevelEdit } from "../actions";

/*
 * TopLevelPanel — edits the venture-profile fields that live outside the
 * `dimensions` object: synthetic_description, intended_end_state,
 * current_maturity, strategic_risks_and_uncertainties (load-bearing),
 * gaps_in_input. Saved as a single human_refined version via saveTopLevel.
 */

const TIMELINE_OPTIONS = ["1", "2", "3", "5", "10"] as const;
type TimelineString = (typeof TIMELINE_OPTIONS)[number];

const MATURITY_OPTIONS = [
  "pre_concept",
  "concept",
  "early_prototype",
  "pilot",
  "early_revenue",
  "scaling",
] as const;

interface TopLevelDraft {
  synthetic_description: string;
  intended_end_state: IntendedEndState;
  current_maturity: VentureProfile["current_maturity"];
  strategic_risks_and_uncertainties: StrategicRisk[];
  gaps_in_input: string[];
}

export function TopLevelPanel({
  profile,
  onSave,
  wasSavedThisSession,
}: {
  profile: VentureProfile;
  onSave: (edit: TopLevelEdit) => Promise<SaveDimensionResult>;
  wasSavedThisSession: boolean;
}) {
  const initial: TopLevelDraft = {
    synthetic_description: profile.synthetic_description,
    intended_end_state: profile.intended_end_state,
    current_maturity: profile.current_maturity,
    strategic_risks_and_uncertainties: profile.strategic_risks_and_uncertainties,
    gaps_in_input: profile.gaps_in_input,
  };
  const [draft, setDraft] = useState<TopLevelDraft>(initial);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<SaveDimensionResult | null>(
    null,
  );

  const handleSave = () =>
    startTransition(async () => {
      const result = await onSave({
        synthetic_description: draft.synthetic_description,
        intended_end_state: draft.intended_end_state,
        current_maturity: draft.current_maturity,
        strategic_risks_and_uncertainties: draft.strategic_risks_and_uncertainties,
        gaps_in_input: draft.gaps_in_input,
      });
      setSaveResult(result);
    });

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="text-base font-semibold tracking-tight">
        Top-level profile fields
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        synthetic_description, intended_end_state, current_maturity,
        strategic_risks_and_uncertainties (load-bearing), gaps_in_input.
      </p>

      <div className="mt-6 space-y-5">
        <TextField
          label="synthetic_description"
          value={draft.synthetic_description}
          onChange={(v) => setDraft({ ...draft, synthetic_description: v })}
          multiline
        />

        <fieldset className="rounded border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            intended_end_state
          </legend>
          <div className="space-y-4">
            <TextField
              label="scale"
              value={draft.intended_end_state.scale}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  intended_end_state: { ...draft.intended_end_state, scale: v },
                })
              }
              multiline
            />
            <EnumField<TimelineString>
              label="timeline_years"
              value={String(draft.intended_end_state.timeline_years) as TimelineString}
              options={TIMELINE_OPTIONS}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  intended_end_state: {
                    ...draft.intended_end_state,
                    timeline_years: parseInt(v, 10) as IntendedEndState["timeline_years"],
                  },
                })
              }
            />
            <TextField
              label="minimum_success_criteria"
              value={draft.intended_end_state.minimum_success_criteria}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  intended_end_state: {
                    ...draft.intended_end_state,
                    minimum_success_criteria: v,
                  },
                })
              }
              multiline
            />
          </div>
        </fieldset>

        <EnumField
          label="current_maturity"
          value={draft.current_maturity}
          options={MATURITY_OPTIONS}
          onChange={(v) => setDraft({ ...draft, current_maturity: v })}
        />

        <StrategicRisksEditor
          values={draft.strategic_risks_and_uncertainties}
          onChange={(arr) =>
            setDraft({ ...draft, strategic_risks_and_uncertainties: arr })
          }
        />

        <StringArrayEditor
          label="gaps_in_input"
          values={draft.gaps_in_input}
          onChange={(arr) => setDraft({ ...draft, gaps_in_input: arr })}
        />
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
