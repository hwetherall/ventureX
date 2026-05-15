# TODOS — VentureX

Living list of open follow-ups. Originally captured during the 2026-05-14 eng review; updated as work lands. Each item has context so it's pickup-able in 3 months.

---

## Done since last update

- ~~README content~~ — written in M1.
- ~~Storage bucket creation~~ — `venture-documents` bucket created in InsForge dashboard.
- ~~Storage RLS policies~~ — migration `0002_storage_policies.sql` applied (owner-only pattern, InsForge-specific syntax).
- ~~Auth implementation~~ — built in M4 alongside upload flow (email/password + 6-digit OTP verification per D9).
- ~~OpenRouter key rotation~~ — done after the original key was exposed in a transcript.
- ~~Drop ABB source documents into `test-cases/abb-rack-pdu/`~~ — confirmed present; M7 successfully ran extraction against them on 2026-05-14, producing a Section 13–passing profile.
- ~~Schema cross-walk with Pedram~~ — superseded. M7 acceptance gate passed without his review; schema is locked. If he wants to flag additions for Phase 3, that's a separate ticket.
- ~~Critic model choice~~ — locked 2026-05-14: `STAGE_1_CRITIC_MODEL=openai/gpt-5.5` (spec default). Env-var swap remains trivial if we later A/B against Gemini 3.1 Pro.
- ~~M9 HITL UI~~ — shipped 2026-05-15. All 7 dimension panels + top-level panel. Load-bearing emphasis on `substitution_landscape` and `strategic_risks.implies_search_for`. Always-active save with "Mark reviewed" / "Save dimension" duality. Inline critic flags per field.
- ~~Design system ratification~~ — 2026-05-15 via `/design-consultation`. DESIGN.md is now the source of truth. CLAUDE.md §17 points at it. Dark mode tokens fixed.
- ~~M10 chain wire-up~~ — `confirmRefinement` now chains into `runStage2Weighting` synchronously and returns a discriminated result with `weightingError` / `weightRowIds`.

---

## Open

### 1. Eval-run non-determinism — Section 13 edge-of-band drift

**What:** Track ABB eval pass rate across consecutive runs. On 2026-05-15 the first run scored 10/13 (Stage 1 missed `in-rack DC` as a distinct substitution mechanism; Stage 2 weights summed to 0.86 which dragged `geography_regulatory` to 0.13 below the 0.15 floor). The second run, same prompt, same model, scored 13/13. LLM non-determinism is real — but the consistent failure surface (in-rack DC distinction; sum < 1.0) suggests we're sitting at the edge of clearing the gate rather than solidly above it.

**Why:** A run-1 failure that becomes a run-2 pass is a coin flip, not a fix. The eval framework's value depends on stable signal — if we land prompt edits while the baseline is noisy, we won't be able to tell whether a change improved things or just landed on the lucky side of a flip.

**Pros of doing now:** Calibrates the prompts past the edge of the band before we layer in Phase 3 work that consumes their output. Cheaper to fix now than after a 2nd eval case lands.
**Cons of doing now:** Two runs is a tiny sample. Maybe the right move is to add a `--runs N` flag to `evals/run.ts` and just take the worst-of-N before iterating.

**Context:**
- Stage 1: prompt likely needs an explicit note that "in-rack DC" (AC → in-rack converter → DC busbar inside the rack) and "facility-level DC distribution" are different substitution mechanisms, both expected to appear.
- Stage 2: prompt already says "sum within [0.97, 1.03]" but the model occasionally produces under-summed output. Consider adding a "before submitting, sum your 7 weights — if outside [0.97, 1.03], scale up your highest-weighted dimensions to compensate" instruction.
- Use D10 triage: prompt fixes before schema. Don't relax the `evals/criteria.ts` thresholds — those mirror CLAUDE.md §13.

**Depends on / blocked by:** Nothing. Cheap to do; budget ~3 eval runs ($0.60-1.00) to confirm a fix is stable.

---

### 2. Stage 1 critic calibration on real extracted profiles

**What:** Re-run `scripts/check-critic.ts` against an actual LLM-extracted profile (not `expected_profile.json`) once M9 lands and we have a real venture row in InsForge. If flag count is still well above CLAUDE.md §9's 4-15 band, tune `prompts/stage_1_critic.md` to soften the bar — likely lower the rate of `unsupported` flags on fields the schema explicitly invites inference for (`time_to_revenue_years`, `defensibility_model`, etc.).

**Why:** M8 verification ran the critic against the hand-curated gold-standard profile and got 38 flags (30 per-dim + 8 top-level). The critic is technically correct that many gold-standard fields go beyond literal doc evidence — but in production the critic reads an LLM-extracted profile that grounds every claim in `supporting_quotes[]`. Need a real production-shape input to tell whether the calibration is a prompt problem or a fixture artifact.

**Pros of doing now:** Sets the right calibration baseline before any consultant sees critic flags surfaced in the HITL UI. A noisy critic is worse than no critic — reviewers will dismiss it.
**Cons of doing now:** Wasted iteration if the issue self-resolves against real extracted input. Cheaper to wait for the natural test point.

**Context:** Use D10's "prompt-tighten before schema-loosen" triage. The schema (`Stage1CriticOutputSchema`) is the downstream contract for the HITL UI — leave it alone unless the model genuinely needs a new field. Adjust the prompt's calibration paragraph + the severity definitions.

**Depends on / blocked by:** M9 (so we have a refine UI flow that produces a real extracted profile; OR M11 eval framework that gives us a structured loop).

---

### 3. HITL save granularity feedback (claude.md Section 16 Q5)

**What:** After the first working version of M9 (HITL UI), run a 30-minute feedback session with someone from the DPZ team to validate save-per-dimension vs save-all-at-end UX.

**Why:** Current spec is save-per-dimension. This is defensible (explicit, version-rich, easy to debug). But consultants might prefer save-all-at-end (one click, less ceremony). A UX choice that's hard to predict without seeing someone use it.

**Pros of doing now:** Cheap signal early. Avoids building UX a user won't tolerate.
**Cons of doing now:** Premature — need a working version to test against. Don't book the meeting before M9 lands.

**Context:** This is a post-M9 task, before any wider rollout. The first version should be exactly per-spec (save-per-dimension) so the test is "does this fit your workflow" not "did we build the right thing."

**Depends on / blocked by:** M9 working version.

---

### 4. Second anonymized eval test case (D7 P1 follow-on)

**What:** Anonymize a second Innovera consulting venture for the eval framework (`evals/cases/<case-id>/`).

**Why:** D7 puts the eval framework in scope for V1 but ships with only ABB. A single test case can't detect generalization failures — a prompt fix on the eventual second case might silently regress ABB, or vice versa. Two cases is the minimum for regression detection.

**Pros of doing now:** Eval framework becomes regression-aware from launch. Catches model-upgrade regressions immediately.
**Cons of doing now:** Anonymizing a real consulting venture is human-only work (review source docs, strip names, write `expected_profile.json`, encode acceptance criteria). Estimated 2-4 hours, all human time.

**Context:** Pick a venture from a different industry than ABB (electrical equipment) so the eval surfaces breadth issues. Good candidates: any consumer-facing venture, any services-heavy venture, any with `asset_type !== 'hardware'`. Anonymization process: replace company name with "VentureY" (or similar), redact specific financial figures, rewrite "industry context" sentences to be generic.

**Depends on / blocked by:** M11 (eval framework built). Pick the venture and start anonymization in parallel with M9-M11.

---

### 5. Login + new-venture form dark mode pass

**What:** Sweep `src/app/login/page.tsx` and `src/app/ventures/new/form.tsx` for Tailwind color shorthands without `dark:` pairings. Replace with the DESIGN.md semantic CSS vars (or explicit dark variants). Roughly the same fix pattern applied to the refine flow on 2026-05-15.

**Why:** The `/design-consultation` refactor on 2026-05-15 only touched the refine flow because that's where the user's complaint surfaced. Login and venture-creation are also dark-mode-broken for the same reason: `text-amber-900 on bg-amber-50`, `text-red-700` without `dark:` pair, etc. CLAUDE.md §17 + DESIGN.md §10 explicitly forbid this pattern.

**Pros of doing now:** Small (~30 min). Cleans up before Pedram or DPZ team see the auth/upload flow on a dark-mode machine. Prevents the "dark mode is broken" perception that the refine refactor was supposed to fix.
**Cons of doing now:** Cosmetic — doesn't block any milestone work.

**Context:** Pattern: replace `border-red-300 bg-red-50 text-red-900` etc. with `border-[color:var(--color-error-border)] bg-[color:var(--color-error-bg)] text-[color:var(--color-error-fg)]`. Same approach already in `refine/page.tsx` and `[id]/page.tsx`.

**Depends on / blocked by:** Nothing.

---

### 6. Phase 3 CLAUDE.md skeleton

**What:** Draft a Phase 3 CLAUDE.md before M12 work begins. Scope: competitor candidate generation, evidence gathering (web search / RAG), scoring against the `dimension_weights` set, ranking. Use the current CLAUDE.md as a structural template.

**Why:** Phases 0-2's CLAUDE.md explicitly defers Phase 3 to a separate spec file. Without a Phase 3 spec, M12 work risks the same kind of mid-build re-scoping that D8 and D10 represented for Phases 0-2 — better to capture the boundaries before code starts.

**Pros of doing now:** Forces a deliberate scope conversation (LLM-only vs web-augmented, candidate count target, scoring approach, output shape). Cheap if Phase 3 is small; high-value if it's not.
**Cons of doing now:** Spec without code is theoretical — some decisions will only crystallize once we have a first candidate-list to look at. Don't over-spec.

**Context:** Three obvious entry-point decisions: (a) LLM-only brainstorm vs web-search-augmented (see PLAN.md "M12 strategy" — options A vs B), (b) what does a "candidate" record look like (name, type, rationale, dimensions_implicated[], evidence[]?), (c) where do candidates live (new `candidate_companies` table, FK to ventures, RLS via the existing venture-JOIN pattern).

**Depends on / blocked by:** M11 finishing (so the canonical handoff from Phase 0-2 → Phase 3 is observable in the DB).

---

## Phase 4 backlog (deferred — captured here so we don't lose them)

These are NOT in scope for Phases 0-2 but documented so future-us has the context.

- **Multi-user team sharing.** Requires swapping storage RLS from owner-only (`uploaded_by =`) to a venture-JOIN pattern that lets team members access docs uploaded by other members. See `insforge/migrations/0002_storage_policies.sql` for the current policy; rewrite to match the "Team-shared Bucket" pattern in `~/.claude/skills/insforge/storage/postgres-rls.md` adapted to JOIN through `ventures.created_by` (or a new `team_id` column on `ventures`).
- **Password reset flow.** M4 covers signup + sign-in + OTP verification. Reset is straightforward via the InsForge SDK: `sendResetPasswordEmail` → `exchangeResetPasswordToken` → `resetPassword`. Same `/login` page can grow a 4th "reset" mode.
- **PPTX support with vision OCR.** Deferred per D2. Use Claude Sonnet for slide-image OCR if/when needed.
- **LLM streaming responses.** Spec'd as synchronous-only for V1 (claude.md Section 12). Streaming adds partial-JSON parsing complexity; revisit when latency UX matters.
