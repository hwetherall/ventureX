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
- ~~Weights UI "Open weights →" link from `/ventures/[id]/page.tsx`~~ — shipped 2026-05-15 alongside M12-T6 work (Generate-candidates button). Page.tsx now renders refine + weights + candidates links as a flex row of CTAs under "Latest profile version" when their respective statuses gate.
- ~~Phase 3 CLAUDE.md skeleton~~ — superseded. PHASE3.md ratified 2026-05-15 via `/plan-ceo-review` in HOLD SCOPE mode; M12 spec (§3-§7) and M13 spec (§6b) both fully written, 12 decisions locked (P3-D1 through P3-D12).

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

### 3. Stage 1 critic calibration on real extracted profiles

**What:** Re-run `scripts/check-critic.ts` against an actual LLM-extracted profile (not `expected_profile.json`) once M9 lands and we have a real venture row in InsForge. If flag count is still well above CLAUDE.md §9's 4-15 band, tune `prompts/stage_1_critic.md` to soften the bar — likely lower the rate of `unsupported` flags on fields the schema explicitly invites inference for (`time_to_revenue_years`, `defensibility_model`, etc.).

**Why:** M8 verification ran the critic against the hand-curated gold-standard profile and got 38 flags (30 per-dim + 8 top-level). The critic is technically correct that many gold-standard fields go beyond literal doc evidence — but in production the critic reads an LLM-extracted profile that grounds every claim in `supporting_quotes[]`. Need a real production-shape input to tell whether the calibration is a prompt problem or a fixture artifact.

**Pros of doing now:** Sets the right calibration baseline before any consultant sees critic flags surfaced in the HITL UI. A noisy critic is worse than no critic — reviewers will dismiss it.
**Cons of doing now:** Wasted iteration if the issue self-resolves against real extracted input. Cheaper to wait for the natural test point.

**Context:** Use D10's "prompt-tighten before schema-loosen" triage. The schema (`Stage1CriticOutputSchema`) is the downstream contract for the HITL UI — leave it alone unless the model genuinely needs a new field. Adjust the prompt's calibration paragraph + the severity definitions.

**Depends on / blocked by:** M9 (so we have a refine UI flow that produces a real extracted profile; OR M11 eval framework that gives us a structured loop).

---

### 4. HITL save granularity feedback (claude.md Section 16 Q5)

**What:** After the first working version of M9 (HITL UI), run a 30-minute feedback session with someone from the DPZ team to validate save-per-dimension vs save-all-at-end UX.

**Why:** Current spec is save-per-dimension. This is defensible (explicit, version-rich, easy to debug). But consultants might prefer save-all-at-end (one click, less ceremony). A UX choice that's hard to predict without seeing someone use it.

**Pros of doing now:** Cheap signal early. Avoids building UX a user won't tolerate.
**Cons of doing now:** Premature — need a working version to test against. Don't book the meeting before M9 lands.

**Context:** This is a post-M9 task, before any wider rollout. The first version should be exactly per-spec (save-per-dimension) so the test is "does this fit your workflow" not "did we build the right thing."

**Depends on / blocked by:** M9 working version.

---

### 5. Second anonymized eval test case (D7 P1 follow-on)

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

### 7. Stage 3 acceptance criteria (§13-equivalent for candidates)

**What:** Hand-curate a §13-equivalent acceptance set for Stage 3 candidate output against ABB. Required entries: Schneider Electric / Eaton / Vertiv / Server Technology in Direct; busbar+tap-off and power-shelf vendors in SPDM; at least 2 of each type; rationale references profile content, not generic. Lives as `test-cases/abb-rack-pdu/expected_candidates.json` (analogous to `expected_profile.json`).

**Why:** Without acceptance criteria, M12 has no pass/fail gate. Eyeball checks don't scale, and the eval framework hookup (TODO #8 below) is blocked until criteria exist. Phase 0-2's §13 was the linchpin of the M7 iteration loop — Phase 3 needs the equivalent.

**Pros of doing now:** Defines "good candidates" before M12 ships, so the implementer has a target. Prereq for M13 comparison ("did web evidence add 15 regional candidates? Which ones?").
**Cons of doing now:** Some criteria may shift after seeing real M12 output. Risk of premature precision.

**Context:** Use M7's prompt-iteration log (PLAN.md D10) as the template. The criteria should be observable from the candidate list alone — no need to inspect rationales for assertion purposes. Pick 6-10 must-have entries; allow 1-2 misses (LLM non-determinism).

**Effort estimate:** S (human: ~2 hours / CC: ~20 min for the structure, ABB-specific content is human-only).
**Priority:** P2 (blocking M12 acceptance gate but not M12 ship).
**Depends on / blocked by:** Nothing. Cheap to do before or alongside M12 code.

---

### 8. Stage 3 hookup into eval framework (after acceptance criteria exist)

**What:** Once TODO #7 lands, extend `evals/criteria.ts` + `evals/runner.ts` to run Stage 3 end-to-end on ABB and assert against the expected_candidates.json. `pnpm tsx --env-file=.env.local evals/run.ts` becomes a single-command end-to-end eval covering all 3 stages.

**Why:** Catches Stage 3 prompt regressions immediately. Same pattern that's already working for Stage 1 + Stage 2 in M11. Without this, prompt edits to `stage_3_candidate_generation.md` need manual ABB re-runs to verify.

**Pros of doing now (i.e., after #7 lands):** Closes the loop from "edit prompt" to "see eval result" in seconds. Strong signal for future Stage 3 iteration.
**Cons of doing now:** Coordination tax with the parallel terminal that owns `evals/`. Wait until M11 work is fully landed.

**Context:** Mirror the Stage 1 + Stage 2 assertion patterns already in evals/. Stage 3 assertions should be the §13-equivalent criteria from TODO #7 expressed as runner checks.

**Effort estimate:** S (human: ~1 hour / CC: ~10 min — pattern is established).
**Priority:** P2.
**Depends on / blocked by:** TODO #7 (acceptance criteria), plus M11 eval framework being fully landed.

---

### 9. Pattern Y migration — add `weights_run_id` grouping UUID to `dimension_weights`

**What:** Migration 0004 (or later — non-blocking) adds a `weights_run_id uuid` column to `dimension_weights`. Each Stage 2 call shares one UUID across its 7 rows. Each batch of `human_adjusted` saves shares one UUID. M12 / M14 read `WHERE weights_run_id = (latest)` instead of the current Pattern X DISTINCT-ON approach.

**Why:** Pattern X (PHASE3.md §3, P3-D4) is fine for V1 but mixes sources implicitly — if a user adjusts 6 sliders, the "current set" is 6 `human_adjusted` + 1 `llm_proposed` rows by created_at. Pattern Y makes the canonical-set boundary explicit, which is what every reader (M12, M14, future analytics) actually wants.

**Pros of doing now (i.e., post-M12):** Cleaner data model long-term. Future-proofs Phase 4 if we add weight-set A/B testing or versioning.
**Cons of doing now:** Requires backfilling existing rows with synthetic UUIDs grouped by `(venture_id, source, profile_version_id, abs(created_at - reference_created_at) < 30s)`. Migration coordination with M11/M12 already shipped.

**Context:** Migration text would be:
```sql
alter table dimension_weights add column weights_run_id uuid;
-- backfill: group rows in same venture+source+profile_version_id with created_at within 30s
-- of each other into a single run_id
update dimension_weights set weights_run_id = ... ; -- (group-by query, generate one uuid per group)
alter table dimension_weights alter column weights_run_id set not null;
create index dimension_weights_run_idx on dimension_weights(venture_id, weights_run_id, created_at desc);
```

**Effort estimate:** M (human: ~3 hours / CC: ~30 min, mostly the backfill query).
**Priority:** P3 (technical debt; non-blocking).
**Depends on / blocked by:** Coordinate with M11 weights UI ship to avoid concurrent migration churn.

---

### 11. Cost + time predictor for M15 cell-research runs (BLOCKS the 5-candidate demo)

**What:** A small CLI (or script) that takes a candidate count + parameter schema (or just a venture_id) and emits an estimate of `(total_cost_usd, est_wall_clock_min)` for a Stage 5 cell-research run. Breaks the estimate down by tier: T1 universal Opus calls × N candidates, T2 framework Opus calls × N candidates, T3 dynamic Exa + Haiku per-cell pairs × (15 params × N candidates). Surfaces the estimate before any code spends money.

**Why:** Tomorrow's demo to Daniel = 5 candidates × 51 parameters = 255 cells. Without a predictor we discover cost only after the bill arrives. With it we get an explicit "go" gate. Also reusable for the 53-candidate scale-out later — the $30–80 per-venture band in `M15_DESIGN.md` is currently a vibes estimate; the predictor turns it into a number we can quote.

**Pros of doing now:** Hard prerequisite for the demo (per `M15_SPRINT_PLAN.md` Sprint scope, post-Daniel-sync update). Cheap to build (~30–60 min CC) because the math is just unit-cost × call-count.
**Cons of doing now:** None — this is on the critical path.

**Context:**
- Unit costs to encode (sourced from current OpenRouter pricing — re-verify before locking):
  - Opus 4.7: ~$15/M input, ~$75/M output → ~$0.20 per batched call at typical Stage 5 token counts.
  - Haiku: ~$0.80/M input, ~$4/M output → ~$0.002 per single-cell extraction.
  - Exa: ~$0.01–0.025 per search (top-3 results).
- Time estimates: Opus batched ~30s; Haiku ~3s; Exa ~2s; with 3-concurrent T3 cap that's ~5 min for 15 cells.
- For the 5-candidate demo: expected ~$3.50–4.50 total, ~30–40 min sequential / ~6–8 min with parallelism.
- Output shape: print a table with `[tier, calls, per_call_usd, subtotal_usd, est_seconds]` rows plus a totals line.

**Effort estimate:** S (human: ~30 min / CC: ~30–60 min).
**Priority:** **P0 — blocks the 5-candidate demo.**
**Depends on / blocked by:** Nothing. Build before M15-T5 ships (or as part of M15-T5 — it shares unit-cost knowledge with the orchestrator's budget cap enforcement).

---

### 10. Extract shared `_orchestrator.ts` helper for stage1-2-3 boilerplate

**What:** After M12 lands, refactor the 4 orchestrators (stage1-extract / stage1-critic / stage2-weight / stage3-candidates) to share common helpers: `formatErrorForUser` switch on the error-class hierarchy, `loadVentureRow`, `assemblePromptWithJsonBlock`, the discriminated-result-or-status='error' outer try-catch shape. New file: `src/server/_orchestrator.ts`.

**Why:** Four orchestrators × ~50 LOC of duplicated error-formatting and venture-loading boilerplate = ~200 LOC that should be ~50. Adding M14's scorer or M13's web-augmented variant gets cheaper after the refactor.

**Pros of doing now (post-M12):** Each subsequent stage cheaper. Bugs in one orchestrator's error handling don't silently exist in the others.
**Cons of doing now:** Premature if Phase 3 ends at M15 with no Stage 5+. The refactor itself is ~2-3 hours of work for ~150 LOC delta — worth it if M14+ are coming, marginal if not.

**Context:** Use the existing stage2-weight.ts as the template (it's the most recent and cleanest). The shared helper should NOT abstract away the stage-specific shape (prompt, schema, status transitions) — only the boilerplate around it. Keep the call-site readable.

**Effort estimate:** M (human: ~3 hours / CC: ~20 min).
**Priority:** P3 (DRY tax; non-blocking).
**Depends on / blocked by:** M12 landing so the 4th orchestrator exists.

---

## Phase 4 backlog (deferred — captured here so we don't lose them)

These are NOT in scope for Phases 0-2 but documented so future-us has the context.

- **Multi-user team sharing.** Requires swapping storage RLS from owner-only (`uploaded_by =`) to a venture-JOIN pattern that lets team members access docs uploaded by other members. See `insforge/migrations/0002_storage_policies.sql` for the current policy; rewrite to match the "Team-shared Bucket" pattern in `~/.claude/skills/insforge/storage/postgres-rls.md` adapted to JOIN through `ventures.created_by` (or a new `team_id` column on `ventures`).
- **Password reset flow.** M4 covers signup + sign-in + OTP verification. Reset is straightforward via the InsForge SDK: `sendResetPasswordEmail` → `exchangeResetPasswordToken` → `resetPassword`. Same `/login` page can grow a 4th "reset" mode.
- **PPTX support with vision OCR.** Deferred per D2. Use Claude Sonnet for slide-image OCR if/when needed.
- **LLM streaming responses.** Spec'd as synchronous-only for V1 (claude.md Section 12). Streaming adds partial-JSON parsing complexity; revisit when latency UX matters.
