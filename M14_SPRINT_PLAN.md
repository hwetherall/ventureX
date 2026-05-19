# M14 Sprint Plan — Per-Candidate Scoring + Ranking

> ## ⚠ SUPERSEDED — DEFERRED TO A FUTURE MILESTONE (2026-05-19)
>
> This sprint plan describes per-candidate × per-dimension Likert scoring
> against the 7 venture dimensions, which was the M14 direction PHASE3.md §2
> originally named. In parallel, Harry built the **parameter builder** (see
> `parameter_builder.md`) and shipped it as the actual M14. Migration 0006
> (parameter_generation_runs) sequences after migration 0005, so the
> scoring path's status enum values (`scoring`, `scored`) remain in the
> constraint but are dormant.
>
> **Scoring artifacts retained as a future-milestone draft** (per user's
> choice 2026-05-19): `src/types/candidate-scoring.ts`,
> `src/types/candidate-scoring.test.ts`, `src/lib/scoring/aggregate.ts`,
> `src/lib/scoring/aggregate.test.ts`, `prompts/stage_4_candidate_scoring.md`.
> All untracked. Migration 0005's columns (`dimension_scores jsonb`,
> `aggregate_score numeric`) remain on `candidate_companies`, dormant
> until a future milestone uses them.
>
> **Decisions P3-D14 through P3-D21** in PHASE3.md describe this deferred
> path's architecture — they are NOT the M14-as-shipped contract. See
> `parameter_builder.md` for the actual M14 spec.
>
> Read past this banner only if you're picking the scoring milestone back up.

---

**Methodology source:** `.claude/pm/[skill]-sprint-plan.md` (7-phase sprint pipeline).
**Adapted for VentureX:** Next.js 16 + React 19 + InsForge + OpenRouter; no Flutter, no Jira/Confluence/FigJam, single-user V1, gstack `/review` + `/security-review` for quality gates.
**Spec source:** `PHASE3.md` §2, §10 (M14 row), to be expanded into a §6c-equivalent section once architecture is locked.
**Status:** Phase 0 decisions locked 2026-05-19 (P3-D14 through P3-D21). `/plan-ceo-review` CLEARED in HOLD SCOPE mode (2 decisions added: P3-D18 aggregate column shape, P3-D19 strict Zod). `/plan-eng-review` CLEARED (2 decisions added: P3-D20 composite index, P3-D21 single UPDATE statement; 2 test additions to M14-T2 scope: aggregate-compute unit test, partial-scoring rejection test). Ready for Phase 4 build.

---

## Sprint scope

**Input:** A venture in `status='candidates_ready'` with N candidates (10–60) sharing one `generation_run_id`, plus its canonical `dimension_weights` set (7 rows summing to ≈1.0).

**Output:** Each candidate carries a per-dimension score (1–5 Likert, schema TBD in Phase 0) and a weighted aggregate score. Candidates are sortable by aggregate score. New `dimension_scores jsonb` column on `candidate_companies` (migration 0005). New venture status `'scoring'` → `'scored'`.

**Out of scope (deferred to M15):** Sortable/filterable table UI, CSV export, side-by-side candidate comparison. M14 ships the data + a minimal read view; M15 builds the consumption surface.

**Not overfitting to ABB:** Acceptance criteria (Phase 5.B) are venture-agnostic shelf-coverage tests modelled on PHASE3.md §6b (P3-D13). ABB is the keystone fixture, but every check is expressible against the profile JSON structure, not against named companies.

---

## Phase 0 — Spec Validation (Sequential)

**Adapted role:** Solo equivalent of `product-spec-architect` — the author validates PHASE3.md M14 scope against this sprint plan before any code lands.

**Tasks:**
1. Re-read PHASE3.md §2 (M14 row) and §10 (M14 deferrals). Confirm the one-line spec is consistent with what this sprint plan proposes.
2. Resolve the four architectural open questions in the "Clarifications" section below. Each clarification corresponds to a decision worth a P3-D14+ entry.
3. Expand PHASE3.md with a §6c-equivalent M14 acceptance criteria section once decisions land. Mirror §6b's venture-agnostic framing.

**Exit gate:** PHASE3.md §6c written; P3-D14 through P3-D17 (or however many) logged.

---

## Phase 1 — Sprint Intake + File Map (Sequential)

**Adapted role:** Solo equivalent of `flutter-orchestrator + cto-advisor` — the author maps M14 work to files and identifies cross-cutting risk before review.

### Sprint File Map

| Layer | New / modified file | Purpose | Touched by |
|---|---|---|---|
| **DB** | `insforge/migrations/0005_dimension_scores.sql` | Add `dimension_scores jsonb` column + `aggregate_score numeric` column (P3-D18) with `CHECK (aggregate_score >= 1.0 AND aggregate_score <= 5.0)` defense-in-depth + status enum extension (`scoring`, `scored`) + composite index `(venture_id, generation_run_id, aggregate_score DESC)` (P3-D20) for M15 latest-run-sorted reads | M14-T1 |
| **Schema** | `src/types/candidate-scoring.ts` (NEW) | Zod schema for `Stage4ScoringOutput` (per-candidate × per-dim Likert + rationale + confidence) with strict-count refinement per P3-D19 | M14-T2 |
| **Schema test** | `src/types/candidate-scoring.test.ts` (NEW) | Round-trip + boundary tests against an ABB fixture; **plus** partial-scoring rejection test per P3-D19 (fixture with 50/53 scored entries asserts `safeParse()` fails with the strict-count refinement error) | M14-T2 |
| **Aggregate helper** | `src/lib/scoring/aggregate.ts` (NEW) | Pure function `computeAggregateScore(scores, weights)` extracted from the orchestrator so it can be unit-tested in isolation. Computes `Σᵢ(scoreᵢ × weightᵢ)` per P3-D16. Called from `runStage4Scoring` after Zod validation, before batch UPDATE | M14-T4 |
| **Aggregate test** | `src/lib/scoring/aggregate.test.ts` (NEW) | Unit tests: happy weighted sum, boundary (all 1s → 1.0, all 5s → 5.0), defensive (weight sum drift outside [0.95, 1.05] throws) | M14-T2 |
| **Schema (existing)** | `src/types/candidate.ts` | Extend `CandidateCompany` with optional `dimension_scores` + `aggregate_score` | M14-T2 |
| **Prompt** | `prompts/stage_4_candidate_scoring.md` (NEW) | Stage 4 prompt body. Mirrors stage_3 structure: ROLE / WHAT YOU GET / WHAT TO PRODUCE / CRITICAL CONSTRAINTS / SELF-AUDIT | M14-T3 |
| **Orchestrator** | `src/server/stage4-score.ts` (NEW) | Load candidates + weights + profile → call LLM → Zod validate → `computeAggregateScore` per row → **single SQL UPDATE with `CASE WHEN id=... THEN ...` clauses** (P3-D21, atomic, one round-trip) → mark `status='scored'`. Reuses `claimReadyStatus` claim point (P3-D5) at `candidates_ready` | M14-T4 |
| **Server action** | `src/app/ventures/[id]/actions.ts` | Add `triggerStage4Scoring(ventureId)` | M14-T5 |
| **Detail page** | `src/app/ventures/[id]/page.tsx` | "Score candidates" button when `status='candidates_ready'`; status badges for `scoring` / `scored` | M14-T5 |
| **Candidates page** | `src/app/ventures/[id]/candidates/page.tsx` | Render scores inline on each card (M15 will replace with a table) | M14-T6 |
| **Eval** | `evals/criteria.ts` + `evals/runner.ts` | Add §6c-equivalent Stage 4 assertions (gated on TODO #7 acceptance fixture) | M14-T7 |
| **Test case fixture** | `test-cases/abb-rack-pdu/expected_scoring.json` (NEW) | Hand-curated ABB scoring expectations | M14-T8 |

**Cross-ticket dependencies:**
- M14-T2 (schema) blocks M14-T3 (prompt) — prompt's worked example references the schema shape.
- M14-T4 (orchestrator) blocks M14-T5 (server action + UI).
- M14-T7 (eval hookup) requires M14-T8 (acceptance fixture) which requires TODO #7 (Stage 3 acceptance criteria) is sequenced first.

**Shared file conflicts:** `src/types/candidate.ts` is touched by both M14-T2 (extension) and M14-T6 (UI consumes the type). T2 lands first; T6 is a downstream consumer. No collision.

### Architecture validation (solo cto-advisor pass)

- ✓ Reuses existing `callLLM` wrapper + budget enforcement (D4); Stage 4 estimated $0.50–1.50 against the $5 per-run cap.
- ✓ Reuses existing `claimReadyStatus` pattern (P3-D5 belt-and-braces atomic transition) — Stage 4 claim point is `'candidates_ready'`.
- ✓ Migration 0005 follows the established pattern (0001 schema, 0002 storage RLS, 0003 candidates + RLS, 0004 citations, 0005 scores).
- ⚠ Status enum extension: `scoring`, `scored` — verify the `ventures.status` check constraint accepts both. (Same pattern as 0003 added `candidates_generating` + `candidates_ready`.)
- ⚠ Existing 4-orchestrator boilerplate duplication (TODO #10) gets worse with a 5th orchestrator. Consider lifting `_orchestrator.ts` shared helpers BEFORE M14-T4 lands, not after. Not a blocker, just a tipping-point signal.

**Exit gate:** User approves the file map + the four Phase 0 architectural decisions before Phase 4 build starts.

---

## Phase 1.5 — Design Gap Fill (Conditional)

**Adapted role:** N/A — VentureX has no Figma. DESIGN.md is the visual spec.

**Tasks:**
1. M14 surface area is small: inline scores on `/ventures/[id]/candidates` card list. No new screens.
2. Check DESIGN.md §10 (color tokens) for treatment of numeric scores — Likert 1–5 should use semantic CSS vars, not raw Tailwind shades (per the dark-mode rule).
3. SKIP otherwise. M15 will own the table-design conversation.

---

## Phase 2 — Parallel Narrow Reviews

**Adapted from 10 reviewers → 3 gstack skills + 1 second opinion.** Solo dev can't run 10 personas in parallel, but the gstack toolkit covers the load-bearing review lenses for this scope.

| Skill | Lens | When to invoke | Output |
|---|---|---|---|
| `/plan-ceo-review` | Scope + strategy ("is M14 ambitious enough?") | After Phase 0 decisions land, before Phase 1 file map approval | HOLD SCOPE verdict expected; flag any premature scope expansion |
| `/plan-eng-review` | Architecture, data flow, edge cases, performance | After Phase 0 + before Phase 4 build | Locked sequencing, error-case enumeration, performance assertions |
| `/codex consult` | Independent 2nd opinion on the scoring call shape | If the LLM call shape decision (Clarification #1) is non-obvious | Adversarial read; "what would break?" |
| `/plan-design-review` | UI/UX of inline score display | Skip for M14 (small surface); defer to M15 |

**Reviewer outputs feed into Phase 3 (review integration).**

---

## Phase 3 — Review Integration (Sequential)

**Adapted role:** Solo equivalent of `cto-advisor tiebreaker` — the author resolves conflicts between CEO + Eng + Codex output before locking the plan.

**Tasks:**
1. Consolidate findings from Phase 2 skills.
2. Resolve conflicts (if any) by reference to the four governing decisions (P3-D14+) from Phase 0.
3. Each blocker becomes an edit to PHASE3.md §6c or to `M14_SPRINT_PLAN.md` build tasks.
4. Re-present consolidated plan for user approval before Phase 4 starts.

---

## Phase 4 — Build (Sequential, Single-Developer)

**Adapted from "parallel build agents split by layer" → "single developer, layer-ordered build sequence."** Solo dev, no parallel agents.

### Build order

1. **M14-T1: Migration 0005** — `dimension_scores jsonb` + `aggregate_score numeric` (CHECK 1.0..5.0) + status enum extension + composite index `(venture_id, generation_run_id, aggregate_score DESC)` per P3-D18 / P3-D20. Applied via InsForge MCP `apply_migration`. Verify with `list_tables` afterward.
2. **M14-T2: Zod schema + helper + 3 test files** — `Stage4ScoringOutputSchema` with strict-count refinement (P3-D19) in `src/types/candidate-scoring.ts`; pure-function `computeAggregateScore` in `src/lib/scoring/aggregate.ts`; three test files: schema round-trip (`candidate-scoring.test.ts`), aggregate compute (`aggregate.test.ts`), partial-scoring rejection (asserts the strict refinement fires on 50/53 fixture). Schema-and-helper commit.
3. **M14-T3: Prompt** — `prompts/stage_4_candidate_scoring.md` mirrors stage_3 structure: ROLE → INPUT shape → OUTPUT shape → 3 worked examples (one per candidate type) → CRITICAL CONSTRAINTS → SELF-AUDIT before returning.
4. **M14-T4: Orchestrator** — `src/server/stage4-score.ts`. Loads candidates + canonical weights + profile, assembles prompt, calls `callLLM`, Zod-validates (strict count per P3-D19), calls `computeAggregateScore` per row, persists via single SQL UPDATE with CASE WHEN (P3-D21), transitions to `status='scored'`.
5. **M14-T5: Server action + button** — `triggerStage4Scoring(ventureId)` server action + "Score candidates" button on `/ventures/[id]` page (visible when `status='candidates_ready'`, disabled during `scoring`).
6. **M14-T6: Candidates page update** — render Likert scores + aggregate inline on existing card list. Color coding via DESIGN.md semantic vars (no raw Tailwind).
7. **M14-T7 / M14-T8: Acceptance fixture + eval hookup** — gated on TODO #7 expected_candidates.json. Eval framework asserts §6c criteria. Lands optionally before M15 if TODO #7 lands; otherwise deferred.

**Disjoint file ownership:** N/A (single developer); commits land sequentially in dependency order.

---

## Phase 4.5 — Motion & Delight Polish

**Adapted role:** N/A for M14 — no new motion surface. Inline score display is static. Defer to M15's table interactions.

---

## Phase 5 — Verification & Quality Gates

### 5.A — Static analysis

- `pnpm tsc --noEmit` — must be clean.
- `pnpm lint` — must be clean.
- `pnpm test:run` — schema round-trip tests + any new orchestrator tests must pass.

### 5.B — Acceptance gate (§6c, venture-agnostic — mirrors §6b)

**Drafted here; to be finalized in PHASE3.md §6c after Phase 0:**

1. **Coverage floor (strict, P3-D19)** — every candidate in the latest `generation_run_id` has 7 `dimension_scores` entries (one per dimension). Zero missing cells. Enforced at the schema layer: `Stage4ScoringOutputSchema` includes a Zod refinement that `output.scores.length === input.candidates.length` matched by case-folded name; a missing entry triggers `LLMValidationError` → `callLLM` retry-once → hard-fail to `status='error'`. No "partially scored" pathway in V1.
2. **Score range** — every score is within the schema-enforced range (1–5 if Likert; TBD in Phase 0).
3. **Weighted aggregate correctness** — `aggregate_score` = Σ(score × weight) ± floating-point tolerance, evaluable from the row alone.
4. **Rank discrimination** — top-quartile candidates have aggregate scores meaningfully separated from bottom-quartile (≥1.0 Likert-point gap on a 1–5 scale, or equivalent). Guards against models flattening all scores to "3 (medium)."
5. **Type-stratified plausibility** — for any venture: Direct candidates' weighted aggregate cluster above SPDM and Category by ≥0.5 (when `product_solution` is the highest-weighted dimension; otherwise reverse the assertion per the highest-weighted dim). This is a venture-agnostic check on whether the scorer understood the weights.
6. **Cost cap** — total Stage 4 cost stays under $2 per run (Stage 4 is the cheapest stage; budget headroom for re-runs).
7. **Anonymization preserved** — rationales don't name the venture's parent. Inherited from Stage 3 (P3-D13 criterion 7).

**ABB-specific operationalization** (lives in `test-cases/abb-rack-pdu/expected_scoring.json`, not in §6c):
- Top-10 aggregate-score candidates must include ≥3 of [Schneider, Eaton, Vertiv, Server Technology, Legrand, Raritan]. (These are the M12/M13 baseline incumbents; any one ABB venture must rank them high given product_solution weight = 0.26.)
- Bottom-10 aggregate-score candidates must include ≥3 of [generic DCIM software vendors, generators-only category players, regional component vendors that don't ship rack PDU]. (Weight-light dimensions = correctly low aggregate.)

### 5.C — Test plan refresh

**Adapted from "Confluence + FigJam":** Single source of truth is the in-repo eval framework (`evals/`). For M14:
- Add Stage 4 assertions to `evals/criteria.ts` (gated on M14-T8).
- Update `evals/runner.ts` to chain Stage 1 → Critic → Stage 2 → Stage 3 → Stage 4 end-to-end against ABB.
- `pnpm eval abb-rack-pdu` should run all 4 stages and emit a single PASS/FAIL summary.

### 5.D — Slash-command quality gates

1. **`/review`** against the cumulative M14 diff. Address blockers; ticket suggestions in TODOS.md.
2. **`/security-review`** against the M14 diff. HIGH/MEDIUM findings are hard gates (per the skill). Stage 4 adds no new external API integration (LLM call goes through existing OpenRouter wrapper) so attack surface is minimal — quick pass expected.

### 5.E — Ship

1. Run M14 end-to-end on the existing ABB venture (currently in `candidates_ready` after the M13 re-run).
2. Verify §6c criteria 1–7 pass against ABB.
3. Update PLAN.md M14 row to "✓ Done".
4. Log P3-D14+ decisions in PHASE3.md.
5. Update PHASE3.md §6c with as-shipped acceptance result (same pattern as §6b's M12 ship result line).
6. M14 ships behind the existing single-user auth — no new external deploy surface.

---

## Open Questions — Clarification Protocol (BEFORE Phase 4)

Per `.claude/pm/[agent]-system-analyst.md` ("do not guess when ambiguity could lead to significant rework"), these four decisions are surfaced before any code lands. Each becomes a P3-D14+ entry once resolved.

### Clarification #1 — Scoring call shape — **LOCKED → A (P3-D14)**

**Decision (2026-05-19):** Single Opus call covering all candidates × all dims inline. Input ~30k tokens (profile + weights + 53 candidate rows), output ~12k tokens (53 × 7 scores + rationales). Est. $0.70–1.00, ~150s.

**Rationale:** Matches M12 + M13 pattern, simplest, lets the model cross-reference candidates against each other. The "diffuse attention" risk is mitigated by a SELF-AUDIT step in the prompt (inheriting the M13 §6b pattern).

**Alternatives considered + rejected:**
- B (batched by type, 3 parallel calls, ~$0.90) — adds orchestration complexity for marginal cost saving; rejected.
- C (one call per candidate, $3–5) — hits the $5 budget cap; rejected on cost grounds.
- D (Sonnet first-pass + Opus refinement, $0.50) — premature optimization; lacks M13 precedent; rejected.

### Clarification #2 — Score scale — **LOCKED → A (P3-D15)**

**Decision (2026-05-19):** Likert 1–5 with single-sentence rationale per (candidate, dim) + per-row confidence. 5 = perfect competitive overlap; 1 = no meaningful overlap.

**Rationale:** Likert 1–5 is the standard scoring rubric in consulting frameworks; rationale + confidence enables M15's table to surface scoring reasoning when users hover.

**Alternatives considered + rejected:**
- B (discrete enum `none | weak | medium | strong | dominant`) — harder to sort, no real cost saving; rejected.
- C (float 0.0–1.0) — invites false precision the model can't reliably deliver; rejected.

### Clarification #3 — Aggregation formula — **LOCKED → A (P3-D16)**

**Decision (2026-05-19):** Weighted sum — `aggregate = Σᵢ(scoreᵢ × weightᵢ)`. Range 1–5 (since weights sum to ≈1).

**Rationale:** Standard, predictable, easy to explain in client-facing output.

**Alternatives considered + rejected:**
- B (weighted geometric mean) — over-penalizes weak dims; not the consulting-standard formula; rejected.
- C (top-3-weighted-dims average) — discards signal from low-weight dimensions; rejected.

### Clarification #4 — Stage 4 evidence sourcing — **LOCKED → A (P3-D17)**

**Decision (2026-05-19):** Profile + weights + candidate name + rationale + citations metadata (no re-fetch).

**Rationale:** The M13 rationales are already the model's per-candidate reasoning; carrying them forward into Stage 4 lets the scorer build on grounded context rather than re-derive it. M13 already paid the Exa cost; no need to re-pay.

**Alternatives considered + rejected:**
- B (re-run per-candidate Exa searches) — adds latency + Exa cost; not obviously better; rejected.
- C (name-only, rationale stripped) — discards M13's grounded reasoning; rejected.

---

## Build Order Summary (post-Phase-3 approval)

Same sequencing as M13's build order, with one extra schema step due to the score-shape complexity:

1. ✓ Phase 0 decisions logged as P3-D14+ in PHASE3.md.
2. ✓ §6c acceptance criteria written in PHASE3.md.
3. **M14-T1:** Migration 0005 (column + status enum).
4. **M14-T2:** Zod schema + round-trip tests.
5. **M14-T3:** Prompt at `prompts/stage_4_candidate_scoring.md` (3 worked examples; SELF-AUDIT step inheriting the §6b pattern).
6. **M14-T4:** Orchestrator at `src/server/stage4-score.ts`.
7. **M14-T5:** Server action + Score-candidates button on `/ventures/[id]`.
8. **M14-T6:** Candidates page renders inline scores.
9. **(Optional / parallel)** M14-T7 + T8: acceptance fixture + eval hookup, gated on TODO #7.
10. ABB end-to-end run + §6c verification.

**Estimated effort:** ~6–8 hours human / ~60–90 min CC. Comparable to M13 because the orchestrator + prompt scaffolding pattern is now mature.

---

## What this plan deliberately does NOT do

(Mirrors PHASE3.md §8 "Things to NOT do" pattern.)

- **Does not** introduce a new model family. Opus 4.7 stays the default, configurable via `STAGE_4_MODEL` env var.
- **Does not** build the sortable table. That's M15.
- **Does not** add scoring-time web search beyond the M13 citations. If a future milestone needs per-(candidate, dim) evidence freshness, add it then.
- **Does not** persist multiple scoring runs as audit trail. Latest score wins via UPDATE on `candidate_companies` (not append-only like profile_versions). If audit-trail need emerges, lift to a `candidate_score_runs` table in a later milestone.
- **Does not** add the `_orchestrator.ts` shared helper extraction (TODO #10). Tipping-point flagged in Phase 1 but explicitly out of M14 scope to avoid coupling refactor + feature.

---

*Drafted 2026-05-19 from `.claude/pm/[skill]-sprint-plan.md`. Adapted for VentureX (Next.js / InsForge / OpenRouter; solo developer; no Jira/Confluence/FigJam). M14 architecture decisions locked in PHASE3.md as P3-D14 through P3-D21 after `/plan-ceo-review` (HOLD SCOPE, CLEAR) and `/plan-eng-review` (CLEAR). Author: Harry (build lead), with Claude as planning collaborator.*

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (HOLD SCOPE) | mode: HOLD_SCOPE, 0 critical gaps, 0 expansions accepted, 2 decisions added (P3-D18 aggregate_score column, P3-D19 strict Zod) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Skipped — both ENG and CEO independently cleared; revisit at M14 ship gate |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 4 issues found, 4 resolved (P3-D20 composite index, P3-D21 single UPDATE, M14-T2 aggregate-test addition, M14-T2 partial-scoring-test addition); 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Skipped — M14 UI surface is minimum-viable inline scores; M15 owns table |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Skipped — internal tool, no external API/CLI/SDK surface |

- **UNRESOLVED:** 0
- **VERDICT:** CEO + ENG CLEARED — ready to implement. Phase 0 complete; locked decisions P3-D14 through P3-D21. Begin Phase 4 with M14-T1 (migration 0005).
