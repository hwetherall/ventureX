# M15 Sprint Plan — Cell Research (the X × Y matrix fill)

**Methodology source:** `.claude/pm/[skill]-sprint-plan.md` (7-phase sprint pipeline).
**Adapted for VentureX:** Next.js 16 + React 19 + InsForge + OpenRouter + Exa; no Flutter, no Jira/Confluence/FigJam, single-user V1, gstack `/review` + `/security-review` for quality gates.
**Spec source:** `M15_DESIGN.md` (approved 2026-05-19 via `/office-hours`, mode = Intrapreneurship). Hybrid Tiered (Approach C) — Tier 1 universal (training-data) / Tier 2 framework (M13-evidence) / Tier 3 dynamic (per-cell Exa + Haiku).
**Status:** Phase 0 IN PROGRESS — open questions surfaced in `M15_DESIGN.md` to be locked here as P3-D22+. `/plan-ceo-review` + `/plan-eng-review` pending. Innovera ingest contract sync pending (assignment from design doc).

---

## Sprint scope

**Input:** A venture in `status='parameters_ready'` with N candidates (10–60) sharing one `generation_run_id`, the canonical parameter schema from `parameter_generation_runs.full_parameter_schema` (51 params, tier-tagged), the canonical `dimension_weights` set, and M13 candidate citations.

**Output:** Each (candidate, parameter) cell carries a researched value, a citation (when applicable), and a confidence tri-state (`verified | inferred | unknown`). For V1 the wedge is **a 5-candidate shortlist dossier** (Schneider Electric + 4 others — e.g. Eaton, Vertiv, Server Technology, Legrand) run end-to-end, shown to Daniel as the demo gate. Daniel's approval of the 5-candidate output unlocks scaling to the remaining 48 candidates. New `cells` table (migration 0007). New venture status `'cells_researching'` → `'cells_ready'`.

**Demo gate (added 2026-05-19, post-Daniel sync):** Before running the 5-candidate demo, a **cost + time predictor** (see TODOS.md #11) emits an estimate. Demo run only proceeds with explicit user "go." This is the V1 budget circuit-breaker; the per-venture $100 cap (P3-D27) is the V1.x safety net.

**Out of scope (deferred to M16 or later):**
- Cell-level editability + re-research affordance with corrective-feedback retry (defer; V1 ships read-only verification).
- Full Innovera export endpoint **unless** the ingest contract is locked before Phase 4 — otherwise defer to M15.5.
- Across-candidate parallelism (V1 sequential; M15.1 introduces parallelism with cap of 5).
- M15 ships behind existing single-user InsForge auth.

**Not overfitting to ABB:** Acceptance criteria (Phase 5.B) are venture-agnostic and modelled on §6b / §6c patterns. Schneider Electric is the keystone first-dossier fixture, but every check is expressible against the parameter schema + cells table structure.

---

## Phase 0 — Spec Validation (Sequential)

**Adapted role:** Solo equivalent of `product-spec-architect` — the author validates `M15_DESIGN.md` against this sprint plan before any code lands.

**Tasks:**
1. Re-read `M15_DESIGN.md` §Premises (5 confirmed) and §Approaches Considered (C chosen). Confirm sprint plan is consistent.
2. **Book the Innovera ingest contract sync** (assignment from design doc §The Assignment). 15 min with the Innovera platform owner; written answer in Slack/doc before Phase 4 build starts. Outcome determines whether M15-T7 (export endpoint) ships in M15 or defers to M15.5.
3. Resolve the six open questions from `M15_DESIGN.md` §Open Questions. Each becomes a P3-D22+ entry.
4. Triage the ten reviewer concerns from `M15_DESIGN.md` §Reviewer Concerns into "decide now in this plan" vs "decide during build."
5. Expand PHASE3.md with an M15 row + §6d-equivalent acceptance criteria once decisions land. Mirror §6b/§6c framing.

**Exit gate:** Innovera ingest contract written down (or explicitly deferred); P3-D22 through ~P3-D28 logged; PHASE3.md §6d drafted.

---

## Phase 1 — Sprint Intake + File Map (Sequential)

**Adapted role:** Solo equivalent of `flutter-orchestrator + cto-advisor` — author maps M15 work to files and identifies cross-cutting risk before review.

### Sprint File Map

| Layer | New / modified file | Purpose | Touched by |
|---|---|---|---|
| **DB** | `insforge/migrations/0007_cells.sql` (NEW) | New `cells` table: `id` / `candidate_id` (FK candidate_companies) / `parameter_key` (text, FK to `parameter_generation_runs.full_parameter_schema[i].key`) / `tier` (enum `t1_universal | t2_framework | t3_dynamic`) / `value jsonb` (typed per param) / `citation jsonb` (url + snippet + retrieved_at, nullable) / `confidence` (enum `verified | inferred | unknown`) / `reason` (text, nullable — e.g. `no_evidence_found`) / `llm_call_id` (FK) / `created_at`. Composite unique `(candidate_id, parameter_key)`. Status enum extension on `ventures`: `cells_researching`, `cells_ready`. Composite index `(candidate_id, tier)` for per-tier resume + `(candidate_id, confidence)` for verification UI. RLS by `created_by` inherited via candidate join. | M15-T1 |
| **Schema** | `src/types/cell.ts` (NEW) | Zod schemas: `CellRow`, `Tier1BatchOutput` (15 cells, citation-optional), `Tier2BatchOutput` (21 cells, M13-citation-required), `Tier3CellOutput` (single cell, fresh Exa citation OR `confidence='unknown'`). Each tier-output schema includes a strict-count refinement (mirrors P3-D19). | M15-T2 |
| **Schema test** | `src/types/cell.test.ts` (NEW) | Round-trip + boundary tests; partial-output rejection (tier returns fewer cells than expected); tri-state confidence boundary; `unknown` + `value=null` + `citation=null` round-trip. | M15-T2 |
| **Exa client** | `src/lib/exa/search.ts` (NEW) | Thin wrapper over Exa API: takes `(query, num_results=3)`, returns top-N results with snippet + URL + retrieved_at. Includes the **retry-on-empty** broadening logic per design doc §Tier 3 fallback chain (drops most-specific keyword from `prompt_hint`). | M15-T3 |
| **Exa client test** | `src/lib/exa/search.test.ts` (NEW) | Mocked-API tests: happy path returns top-3; empty-result triggers broadened-query retry; second empty returns null (caller handles). | M15-T3 |
| **Prompts** | `prompts/stage_5_tier1_universal.md` (NEW) | Batched per-candidate Opus call. ROLE / INPUT (profile + candidate name + 15 Tier 1 param schema entries with prompt_hints) / OUTPUT (15 cells, training-data values, citation expectation EXPLICITLY NONE per design doc §Success Criteria #1) / SELF-AUDIT. | M15-T4 |
| **Prompts** | `prompts/stage_5_tier2_framework.md` (NEW) | Batched per-candidate Opus call. ROLE / INPUT (profile + candidate name + M13 rationale + M13 citations + 21 Tier 2 param schema entries) / OUTPUT (21 cells with M13-citation-by-ID echo — worked example shows the exact shape per design doc §Reviewer Concerns row 2) / CRITICAL: do not invent citations beyond the supplied M13 set / SELF-AUDIT. | M15-T4 |
| **Prompts** | `prompts/stage_5_tier3_dynamic.md` (NEW) | Per-cell Haiku/Sonnet extraction. ROLE / INPUT (single param prompt_hint + Exa top-3 snippets with URLs) / OUTPUT (1 cell: value + citation chosen from supplied URLs + confidence) / CRITICAL: must cite ONE of the supplied URLs OR return `confidence='unknown'` with null value+citation. | M15-T4 |
| **Tier 3 query builder** | `src/lib/exa/query.ts` (NEW) | Pure function `buildTier3Query(paramPromptHint, candidateName, ventureContext)` returns the Exa query string. Worked example resolves design doc §Reviewer Concerns row 3. | M15-T3 |
| **Tier 3 query test** | `src/lib/exa/query.test.ts` (NEW) | Unit tests: candidate name + param prompt_hint compose deterministically; broadening drops the most-specific keyword (helper used by `search.ts` retry). | M15-T3 |
| **Orchestrator** | `src/server/stage5-cells.ts` (NEW) | The big one. `claimParametersReadyStatus` (atomic, mirrors P3-D5). Loads candidate set + latest parameter schema + M13 evidence + canonical weights. For each candidate **sequentially (V1)**: T1 batched Opus → write 15 cells; T2 batched Opus → write 21 cells; T3 loop with **3-concurrent Exa+Haiku cap** (design doc §Concurrency) → write 15 cells. Each tier writes incrementally (resume checkpoint per design doc §Idempotency). On Exa-empty: retry broadened; if still empty, write `confidence='unknown'` with reason. Status transitions per-candidate, not per-venture. Finally marks venture `status='cells_ready'` after the wedge candidate completes. | M15-T5 |
| **Orchestrator helpers** | `src/server/_stage5-helpers.ts` (NEW) | Shared: tier classification reader (one-line: `parameter.tier`), per-tier prompt assembly, Exa+Haiku pair runner, p-limit-3 concurrency wrapper, batch UPDATE writer mirroring P3-D21 (single CASE WHEN UPDATE per tier). | M15-T5 |
| **Server action** | `src/app/ventures/[id]/actions.ts` | Add `triggerStage5CellResearch(ventureId, candidateId?)` — `candidateId` optional, used by the wedge flow (one candidate) and the post-approval scale-out (loops the remaining 52). | M15-T6 |
| **Detail page** | `src/app/ventures/[id]/page.tsx` | "Research candidate dossiers" button when `status='parameters_ready'`; status badges for `cells_researching` / `cells_ready`; per-candidate progress indicator (tier completion). After wedge dossier review: "Approve all 53" button visible only when the wedge candidate is `cells_ready` AND consultant has clicked Approve on the dossier page. | M15-T6 |
| **Dossier page** | `src/app/ventures/[id]/dossier/[candidate]/page.tsx` (NEW) | Per-candidate read-only verification view. Lists 51 cells grouped by tier with: value, citation (clickable link + snippet preview), confidence badge, source (`unknown` cells flagged in zinc-amber). "Approve dossier" button at the bottom transitions the candidate to `cells_approved` and (if this is the wedge) unlocks the venture-level "Approve all 53" button. DESIGN.md semantic vars only. | M15-T7 |
| **Logging contract** | (existing) `src/lib/openrouter/call.ts` + `src/lib/exa/search.ts` | Each tier call logs to `llm_call_logs` with `stage='stage_5_t1' / 'stage_5_t2' / 'stage_5_t3'` per design doc §Reviewer Concerns row 9. Exa calls log to a parallel `exa_call_logs` table — covered by migration 0007 sub-step. | M15-T1 + M15-T5 |
| **Budget cap** | `src/lib/openrouter/budget.ts` | Add per-venture budget cap of $100 (P3-D22+) separate from existing per-run $5 cap (D4). Halt when exceeded; surface to user for explicit retry authorization. | M15-T5 |
| **Innovera export** | `src/app/api/ventures/[id]/export/route.ts` (NEW, conditional) | Export endpoint for Innovera ingest. **Ships in M15 only if the ingest contract is locked by Phase 0 exit.** Otherwise deferred to M15.5 — `cells_ready` is still useful without it because the dossier page is the consultant verification surface. | M15-T8 (conditional) |
| **Eval** | `evals/criteria.ts` + `evals/runner.ts` | Add §6d-equivalent Stage 5 assertions (gated on completion of TODO #7 + a new `expected_cells.json` fixture for Schneider). | M15-T9 |
| **Test case fixture** | `test-cases/abb-rack-pdu/expected_cells_schneider.json` (NEW) | Hand-curated expected cells for the Schneider dossier — 51 cells with tier tags, expected confidence distribution, and 5–10 spot-check (value, citation) assertions per design doc §Success Criteria. | M15-T9 |

**Cross-ticket dependencies:**
- M15-T2 (schemas) blocks M15-T4 (prompts) — prompt worked examples reference schema shapes.
- M15-T3 (Exa client + query builder) blocks M15-T5 (orchestrator) — orchestrator imports them.
- M15-T4 (prompts) blocks M15-T5 (orchestrator) — orchestrator loads prompts.
- M15-T5 (orchestrator) blocks M15-T6 (server action + button) and M15-T7 (dossier page).
- M15-T7 (dossier page) blocks the Schneider wedge ship — consultant needs the verification surface.
- M15-T8 (Innovera export) is conditional on Phase 0 contract sync.
- M15-T9 (eval hookup) blocks the ABB-end-to-end re-run but not the Schneider-only wedge ship.

**Shared file conflicts:** None. Each new module is greenfield. `actions.ts` and `page.tsx` extensions are additive (new exports, new conditional render branches) so no concurrent-edit risk in a solo-dev sequential build.

### Architecture validation (solo cto-advisor pass)

- ✓ Tiered investment matches §Why tiered: T1 cheap, T2 reuses M13 grounding, T3 deep where it matters.
- ✓ Wedge (one candidate) contains cost-blast-radius if T3 misbehaves — design doc P3 explicitly honored.
- ✓ Reuses existing `callLLM` wrapper + budget enforcement (D4) with new per-venture cap layered on top.
- ✓ Reuses `claimReadyStatus` pattern at `parameters_ready`.
- ✓ Migration 0007 follows established pattern (0001–0006).
- ⚠ **Orchestrator boilerplate (TODO #10)** is now 6 stages of duplicated scaffolding. M15-T5 is the largest orchestrator yet — strongly consider extracting `_orchestrator.ts` shared helpers BEFORE M15-T5 lands. Not a hard blocker; flagged for Phase 3 decision.
- ⚠ **Exa rate-limit risk**: 15 Tier 3 cells × 53 candidates = 795 Exa calls per venture. At 3-concurrent cap that's ~265 serial-equivalent calls; verify Exa account headroom. If rate-limited, M15.1 either lowers the cap or batches calls via Exa's `findSimilar`/`search` bulk paths.
- ⚠ **Citation-grounded T2**: T2's "echo M13 citation by ID" approach is novel — worked example in the prompt is load-bearing. Codex consult recommended for this prompt specifically (Phase 2).

**Exit gate:** User approves the file map + the Phase 0 architectural decisions before Phase 4 build starts.

---

## Phase 1.5 — Design Gap Fill (Conditional)

**Adapted role:** N/A — VentureX has no Figma. DESIGN.md is the visual spec.

**Tasks:**
1. M15 introduces **one genuinely new surface**: the per-candidate dossier page at `/ventures/[id]/dossier/[candidate]`. Design treatment:
   - Cells grouped by tier with a left-rule emphasis (mirror DESIGN.md §load-bearing fields treatment — Tier 3 cells get the 2px indigo left rule because they are the venture-specific differentiator).
   - Confidence badges use semantic CSS vars: `verified` = indigo, `inferred` = zinc-neutral, `unknown` = zinc-amber. No raw Tailwind shades.
   - Citation snippets shown inline (truncated to ~120 chars with hover-to-expand). URL click opens in new tab.
2. Consultant verification ergonomics: the "Approve dossier" button is the load-bearing CTA; primary indigo per DESIGN.md.
3. Check DESIGN.md for any treatment of the `unknown` state — if not specified, add a §11 entry.

---

## Phase 2 — Parallel Narrow Reviews

**Adapted from 10 reviewers → 3 gstack skills + 1 second opinion.** Solo dev can't run 10 personas in parallel, but the gstack toolkit covers the load-bearing review lenses for this scope.

| Skill | Lens | When to invoke | Output |
|---|---|---|---|
| `/plan-ceo-review` | Scope + strategy ("is the wedge the right wedge?") | After Phase 0 decisions land, before Phase 1 file map approval | HOLD SCOPE verdict expected; the wedge-first-then-scale flow is exactly the kind of scope discipline CEO mode endorses; flag any reviewer push to skip the wedge |
| `/plan-eng-review` | Architecture, data flow, concurrency, edge cases | After Phase 0 + before Phase 4 build | Locked sequencing, error-case enumeration, Exa rate-limit assertions, tier-resume invariants |
| `/codex consult` | Independent 2nd opinion on the T2 citation-echo prompt shape | Tier 2's "echo M13 citation by ID, do not invent" is the most novel constraint in the plan; codex adversarial pass before lock | "What would break?" — likely surfaces shape-of-M13-citation drift risk |
| `/plan-design-review` | UI/UX of the dossier verification page | Before M15-T7 lands; this is a real new surface | Confidence-state visual treatment locked; `unknown` flag UX validated |

**Reviewer outputs feed into Phase 3 (review integration).**

---

## Phase 3 — Review Integration (Sequential)

**Adapted role:** Solo equivalent of `cto-advisor tiebreaker` — the author resolves conflicts between CEO + Eng + Codex + Design output before locking the plan.

**Tasks:**
1. Consolidate findings from Phase 2 skills.
2. Resolve conflicts (if any) by reference to the M15 Phase 0 decisions (P3-D22+) and the design doc §Premises (5 confirmed).
3. Each blocker becomes an edit to PHASE3.md §6d or to `M15_SPRINT_PLAN.md` build tasks.
4. Decide whether to lift `_orchestrator.ts` shared helpers before M15-T5 (Phase 1 flagged this as a tipping-point signal).
5. Re-present consolidated plan for user approval before Phase 4 starts.

---

## Phase 4 — Build (Sequential, Single-Developer)

**Adapted from "parallel build agents split by layer" → "single developer, layer-ordered build sequence."** Solo dev, no parallel agents.

### Build order

1. **M15-T1: Migration 0007** — `cells` table + `exa_call_logs` table + `cells_researching` / `cells_ready` status enum extension + composite indexes. Applied via InsForge MCP `apply_migration`. Verify with `list_tables` afterward. Storage RLS not needed (no new buckets); table RLS inherits via candidate join.
2. **M15-T2: Zod schemas + tests** — `Tier1BatchOutputSchema`, `Tier2BatchOutputSchema`, `Tier3CellOutputSchema` with strict-count refinements; `CellRow` row shape; round-trip + boundary + partial-rejection tests in `src/types/cell.test.ts`.
3. **M15-T3: Exa client + query builder** — `src/lib/exa/search.ts` (with broadening retry) + `src/lib/exa/query.ts` (pure function) + tests. Includes the prompt_hint → query worked example.
4. **M15-T4: Three prompts** — `stage_5_tier1_universal.md`, `stage_5_tier2_framework.md`, `stage_5_tier3_dynamic.md`. Each follows ROLE → INPUT → OUTPUT → CRITICAL → SELF-AUDIT structure. T2 prompt includes the worked M13-citation-echo example.
5. **(Decision point per Phase 3)** Optional: extract `_orchestrator.ts` shared helpers from M11–M14 orchestrators. Lands BEFORE M15-T5 if Phase 3 says yes.
6. **M15-T5: Orchestrator + helpers** — `src/server/stage5-cells.ts` + `src/server/_stage5-helpers.ts`. Implements the per-candidate sequential loop with per-tier incremental writes (resume checkpoint), 3-concurrent T3 Exa+Haiku cap, broadened-query retry, `unknown` fallback. Per-venture budget cap of $100 layered over existing $5 per-run cap.
7. **M15-T6: Server action + button** — `triggerStage5CellResearch(ventureId, candidateId?)` server action + "Research candidate dossiers" button on `/ventures/[id]`. Button kicks off the **wedge candidate only** (Schneider for ABB). "Approve all 53" button appears after wedge approval.
8. **M15-T7: Dossier page** — `/ventures/[id]/dossier/[candidate]/page.tsx`. Read-only verification surface with cell list grouped by tier, confidence badges, citation links, "Approve dossier" CTA.
9. **(Conditional) M15-T8: Innovera export endpoint** — only if Phase 0 ingest contract is locked. JSON export of all cells for one venture in the shape Innovera specified.
10. **M15-T9: Acceptance fixture + eval hookup** — `expected_cells_schneider.json` + Stage 5 assertions in `evals/criteria.ts`. Gated on TODO #7 (Stage 3 acceptance fixture) being resolved first.

**Disjoint file ownership:** N/A (single developer); commits land sequentially in dependency order.

---

## Phase 4.5 — Motion & Delight Polish

**Adapted role:** Lightweight pass. The dossier page has one delight opportunity: a progress indicator showing tier-by-tier completion during research (T1 done → T2 done → T3 in-progress with cell count). Use existing DESIGN.md motion tokens; respect `prefers-reduced-motion`. No new animation library.

---

## Phase 5 — Verification & Quality Gates

### 5.A — Static analysis

- `pnpm tsc --noEmit` — must be clean.
- `pnpm lint` — must be clean.
- `pnpm test:run` — schema round-trip + Exa client + query builder + aggregate helper tests must pass.

### 5.B — Acceptance gate (§6d, venture-agnostic — mirrors §6b/§6c)

**Drafted here; to be finalized in PHASE3.md §6d after Phase 0:**

1. **Coverage floor** — for the wedge candidate: 51 cells exist (15 T1 + 21 T2 + 15 T3); zero missing rows. Enforced via composite unique `(candidate_id, parameter_key)` + post-research count assertion.
2. **Tier-1 citation expectation** — T1 cells may have null citations (training-data values); this is by design. ≥90% of T1 cells have non-null values.
3. **Tier-2 citation discipline** — ≥85% of T2 cells carry a citation that resolves to a URL in the candidate's M13 citation set (no invented URLs).
4. **Tier-3 citation freshness** — ≥85% of T3 cells carry a non-null citation with `retrieved_at` within the current research run; the remainder are honest `confidence='unknown'` rather than fabricated.
5. **Confidence distribution sanity** — ≥70% of T2 + T3 cells (36 combined) are at `confidence='verified'`; `unknown` rate < 20%.
6. **Hallucination rate** — of cited cells (T2 + T3 combined), <5% have citations that don't actually support the value when spot-checked by the consultant. Sampled audit: consultant clicks through 10 random cited cells; ≥9 must verify cleanly.
7. **Cost in band** — per-venture cost lands in $30–80 (design doc target). Wedge candidate alone should be ~$1–2 (one candidate's 51 cells).
8. **Latency in band** — wedge candidate dossier completes end-to-end in <30 minutes (design doc §Success Criteria #1).
9. **Verification ergonomics** — consultant verifies 36 cited cells in <15 minutes (timed against the dossier page).
10. **Anonymization preserved** — cell values + rationales don't name the venture's parent. Inherited from prior stages.

**Schneider-specific operationalization** (lives in `test-cases/abb-rack-pdu/expected_cells_schneider.json`, not in §6d):
- `founded_year` ≈ 1836; `hq_location` = France; `revenue_band` in [10B+]; `product_lines` includes "rack PDU" — these are T1 universals that should all land verified.
- Tier 3 cells like `latest_product_announcement`, `recent_acquisitions`, `data_center_strategy_signals` must each carry a fresh Exa citation with `retrieved_at` within the run window.
- `confidence='unknown'` rate < 15% for Schneider (a well-documented incumbent).

### 5.C — Test plan refresh

**Adapted from "Confluence + FigJam":** Single source of truth is the in-repo eval framework (`evals/`). For M15:
- Add Stage 5 assertions to `evals/criteria.ts` (gated on M15-T9).
- Update `evals/runner.ts` to chain Stage 1 → Critic → Stage 2 → Stage 3 → Stage 4 (when M14b lands) → Stage 5 end-to-end against ABB.
- `pnpm eval abb-rack-pdu --stage=5 --candidate=schneider` should run only the Schneider wedge dossier and emit a PASS/FAIL summary against §6d 1–10.

### 5.D — Slash-command quality gates

1. **`/review`** against the cumulative M15 diff. Address blockers; ticket suggestions in TODOS.md. Expect findings around orchestrator complexity and Exa retry edge cases.
2. **`/security-review`** against the M15 diff. HIGH/MEDIUM findings are hard gates. Stage 5 adds **one new external API integration** (Exa) — verify: API key in env (not committed), no PII leaving the system in queries, rate-limit handling, no SSRF through user-controlled query construction. Quick-to-medium pass expected.

### 5.E — Ship

1. **Run the cost+time predictor** (TODOS.md #11) — emit estimate for the 5-candidate shortlist. User confirms "go."
2. Run M15 end-to-end on the ABB venture for the 5-candidate shortlist (Schneider + 4 others).
3. Verify §6d criteria 1–10 pass against the 5-candidate output.
4. Consultant (Harry) verifies the cited cells across all 5 dossiers via the dossier page; record actual verification time.
5. **Demo to Daniel** — show the 5 dossiers; lock the remaining ingest-contract decisions (Clarification #3 open items) from his reaction to the concrete artifact.
6. If §6d passes AND Daniel approves: click "Approve all 48" to scale out the remaining candidates sequentially (V1) or accept the deferral to M15.1 (parallelism cap of 5).
7. Update PLAN.md M15 row to "✓ Done" (with wedge-only / demo-only / full-scale note).
8. Log P3-D22+ decisions in PHASE3.md.
9. Update PHASE3.md §6d with as-shipped acceptance result.
10. M15 ships behind the existing single-user auth — no new external deploy surface.

---

## Open Questions — Clarification Protocol (BEFORE Phase 4)

Per `.claude/pm/[agent]-system-analyst.md` ("do not guess when ambiguity could lead to significant rework"), these decisions are surfaced before any code lands. Each becomes a P3-D22+ entry once resolved. The six come from `M15_DESIGN.md` §Open Questions; "leans" carry forward from the design doc.

### Clarification #1 — Cell storage shape — **LEAN → B (separate `cells` table)** — to lock as P3-D22

**Lean rationale:** Separate `cells` table is cleaner for Innovera export, per-cell queries, sort/filter flexibility in M16+. Adds one table but the schema is simple and the migration is straightforward. Lossy alternative (jsonb on `candidate_companies`) would force every consumer to parse and re-shape.

**Alternative considered:** jsonb on `candidate_companies` — atomic with candidate row, simpler — rejected on M16 flexibility grounds.

### Clarification #2 — Confidence tri-state encoding — **LOCKED → A (enum)** (P3-D23)

**Decision (2026-05-19, confirmed by Daniel / Innovera platform owner):** Tri-state enum `verified | inferred | unknown`. **Numeric confidence scores explicitly dropped** — Innovera will consume the tri-state directly, no parallel numeric column.

**Rationale:** Confirmed by the downstream consumer in conversation. Removes the "option to add numeric later" hedge — Innovera's analysis engine works on the categorical signal, not a weighted float.

**Alternative considered + rejected:** numeric 0.0–1.0 with thresholds — Innovera doesn't want it.

### Clarification #3 — Innovera ingest contract — **PARTIALLY LOCKED — DEMO-FIRST CONTRACT NEGOTIATION** — to lock as P3-D24

**Status (2026-05-19, post-Daniel sync):** Confidence encoding locked (see Clarification #2). Remaining contract decisions (transport, granularity, field naming, citation attachment, tier flagging) deferred to **post-demo lock**: Daniel reviews the 5-candidate output tomorrow and reacts to a concrete artifact rather than negotiating in the abstract.

**Implication for M15-T8:** Export endpoint cannot be built until post-demo. M15-T8 explicitly defers to M15.5 unless the demo lands the contract in one shot. M15 wedge ships with the dossier page as the V1 consultant verification surface (still useful — Daniel can see all 5 dossiers via the UI).

**Open decisions to land at the demo:** JSON shape vs CSV vs API? Field naming conventions? Tier flagging in the export? Citation URL+snippet attached or value-only? Per-candidate file or single-blob-per-venture?

### Clarification #4 — Consultant verification UI — **LEAN → A (minimal read-only)** — to lock as P3-D25

**Lean rationale:** V1 ships read-only dossier page with citation links and confidence badges. Cell-level overrides + audit trail is M16 polish. Honors design doc Premise P3 (verification cost dominates) — read-only is the fastest path to fast verification.

**Alternative considered:** editable cells with audit trail — rejected on V1 scope; defer to M16.

### Clarification #5 — Cell re-research affordance — **LEAN → DEFER TO M16** — to lock as P3-D26

**Lean rationale:** Mirroring the M14 P3-D21 corrective-feedback retry pattern is the right long-term answer, but V1's wedge-then-scale flow gives consultants a coarser gate: reject the wedge dossier → re-research the wedge with prompt iteration. Per-cell retry is M16.

**Alternative considered:** ship per-cell retry in V1 — rejected; the wedge gate is the V1 quality circuit-breaker.

### Clarification #6 — Cost cap — **LEAN → per-venture $100 cap, separate from per-run $5 (D4)** — to lock as P3-D27

**Lean rationale:** M15 at $30–80 per venture blows past D4's $5 per-run cap. Adding a per-venture tier preserves D4's safety semantics (one bad LLM call won't blow $50) while accommodating the legitimate per-venture spend. $100 cap leaves headroom for re-research within the same venture.

**Alternative considered:** widen D4 to $100 — rejected; loses the per-run safety net.

### Plus: Reviewer Concerns from `M15_DESIGN.md` (10 deferred items)

These are sprint-stage decisions to resolve INLINE during Phases 0–3, not separate Pn-Dn entries:

1. **Tier-classification source** — confirmed: read from `parameter_generation_runs.full_parameter_schema[i].tier`. One-line eng-review fix. ✓ Resolved inline.
2. **Tier 2 prompt M13 citation passing shape** — worked example in `stage_5_tier2_framework.md`: citations are echoed by ID, not verbatim. Codex consult (Phase 2) validates the exact shape.
3. **Tier 3 Exa query construction** — worked example in `src/lib/exa/query.ts` + `stage_5_tier3_dynamic.md`: prompt_hint is templated into the query, not used as natural language.
4. **Cell-research UI ownership** — "Approve all 53" button lives on `/ventures/[id]` page, not on the dossier page (the dossier page is per-candidate). ✓ Resolved.
5. **Build order T4 split** — `M15_DESIGN.md` recommended splitting into T4a/T4b/T4c. **Decision:** keep as M15-T4 (prompts only) + M15-T5 (orchestrator including Exa client integration). The orchestrator and prompts are tightly coupled enough that splitting adds friction.
6. **Cell re-research affordance** — deferred to M16 (see Clarification #5).
7. **Innovera export endpoint** — conditional (see Clarification #3).
8. **Hallucination audit method** — defined in §6d criterion 6 above: consultant spot-checks 10 random cited cells; ≥9 must verify cleanly.
9. **Logging contract** — defined in file map: `stage='stage_5_t1' / 't2' / 't3'` in `llm_call_logs`; Exa calls in `exa_call_logs`. ✓ Resolved.
10. **Per-venture budget cap** — see Clarification #6.

---

## Build Order Summary (post-Phase-3 approval)

1. ✓ Phase 0 decisions logged as P3-D22 through P3-D27 in PHASE3.md.
2. ✓ §6d acceptance criteria written in PHASE3.md.
3. ✓ Innovera ingest contract sync completed (or M15-T8 explicitly deferred to M15.5).
4. **M15-T1:** Migration 0007 (cells table + exa_call_logs + status enum + indexes).
5. **M15-T2:** Zod schemas + tests.
6. **M15-T3:** Exa client + query builder + tests.
7. **M15-T4:** Three prompts (T1 universal, T2 framework, T3 dynamic).
8. **(Optional)** `_orchestrator.ts` shared helpers extraction if Phase 3 says yes.
9. **M15-T5:** Orchestrator at `src/server/stage5-cells.ts` + helpers.
10. **M15-T6:** Server action + "Research candidate dossiers" + "Approve all 53" buttons on `/ventures/[id]`.
11. **M15-T7:** Dossier page at `/ventures/[id]/dossier/[candidate]`.
12. **(Conditional)** M15-T8: Innovera export endpoint.
13. **M15-T9:** Acceptance fixture + eval hookup (gated on TODO #7).
14. ABB → Schneider wedge end-to-end run + §6d verification.
15. (If wedge passes) Scale to remaining 52 candidates.

**Estimated effort:** ~10–12 hours human / ~2–3 hours CC for the 5-candidate wedge (design doc §Approach C effort estimate; the build effort doesn't change with wedge size, only the run-time does). 5-candidate demo run latency: ~30–40 min sequential or ~6–8 min with M15.1 parallelism. Scale-out from 5 → 53 adds ~1.5–4 hours wall-clock at sequential V1 latency (~6–8 min per candidate × 48).

---

## What this plan deliberately does NOT do

(Mirrors PHASE3.md §8 "Things to NOT do" pattern.)

- **Does not** ship across-candidate parallelism in V1. Sequential per design doc §Concurrency; M15.1 adds cap-of-5 parallelism after the wedge validates the pipeline.
- **Does not** ship cell-level editability or per-cell re-research retry. Read-only verification in V1; M16 owns editing affordances.
- **Does not** bypass the wedge. The "Approve all 53" button is gated on consultant approval of the wedge dossier — design doc P3 (verification dominates) is load-bearing here.
- **Does not** fabricate Tier 3 cells from training data when Exa returns empty. Design doc §Tier 3 fallback chain is explicit: broaden once, then honest `unknown` with reason.
- **Does not** introduce a new model family beyond Opus + Haiku. Sonnet remains available via env var for T3 extraction if Haiku quality is insufficient.
- **Does not** persist multiple cell-research runs as audit trail in V1. Latest cells win via UPSERT on `(candidate_id, parameter_key)`. Re-research = overwrite. If audit-trail need emerges, lift to a `cell_research_runs` table in M16.
- **Does not** add agentic Exa loops (design doc Approach D rejected on bounding grounds).

---

*Drafted 2026-05-19 from `.claude/pm/[skill]-sprint-plan.md` + `M15_DESIGN.md`. Adapted for VentureX (Next.js / InsForge / OpenRouter / Exa; solo developer; no Jira/Confluence/FigJam). M15 architecture decisions to be locked in PHASE3.md as P3-D22 through P3-D27 after `/plan-ceo-review` + `/plan-eng-review` + Innovera ingest contract sync. Author: Harry (build lead), with Claude as planning collaborator.*

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | PENDING | Wedge-first-then-scale is HOLD_SCOPE-shaped; CEO mode pass expected to clear without expansion |
| Codex Review | `/codex consult` | T2 citation-echo prompt 2nd opinion | 0 | PENDING | Adversarial pass on `stage_5_tier2_framework.md` worked example before lock |
| Eng Review | `/plan-eng-review` | Architecture, concurrency, Exa edge cases (required) | 0 | PENDING | Tier-resume invariants, Exa rate-limit handling, orchestrator extraction tipping-point |
| Design Review | `/plan-design-review` | Dossier page UX | 0 | PENDING | Confidence-state visual treatment; `unknown` UX; load-bearing T3 indigo left rule |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Skipped — internal tool, no external API/CLI/SDK surface |

- **UNRESOLVED:** Innovera ingest contract transport/granularity/citation/tier decisions (Clarification #3 remaining items) — deferred to post-demo lock with Daniel; blocks M15-T8 only, not the 5-candidate wedge ship.
- **RESOLVED 2026-05-19 post-Daniel sync:** Clarification #2 LOCKED → tri-state enum confirmed (no numeric column). Wedge sized to 5 candidates (not 1 Schneider). Cost+time predictor added as a hard prerequisite (TODOS.md #11).
- **VERDICT:** DRAFT — Phase 0 mostly complete. Five remaining P3-D22+ decisions to lock + cost predictor to build, then run `/plan-ceo-review` → `/plan-eng-review` → `/codex consult` → `/plan-design-review` before Phase 4 build.
