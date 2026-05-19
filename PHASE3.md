# VentureX — Phase 3 Spec (Candidate Generation, Scoring, Ranking)

**Status:** Draft, locked 2026-05-15 via `/plan-ceo-review` (HOLD SCOPE mode).
**Source of truth:** this file for Phase 3. Root `CLAUDE.md` remains the spec for Phases 0-2. `PLAN.md` is shared execution status.
**Companion docs:** `DESIGN.md` (visual system, applies here too), `TODOS.md` (open follow-ups), `PLAN.md` (milestone tracking).

---

## 1. What you're building, and why

Phases 0-2 produce a clean, human-confirmed, weighted venture profile. Phase 3 turns that into a ranked list of competitor candidates a consultant can use directly in client work.

**The hard problem this solves:** Competely.ai is good at filling in cells once you give it logos. It is bad at picking the right logos. Phase 3 IS the logo-picker.

**Why Phase 3 has its own spec file:** Phase 0-2 went through M1-M11 with one CLAUDE.md and ~12 decisions (D1-D11). Phase 3 has its own architecture (new orchestrator, new table, new UI surface), its own model choices, and its own acceptance criteria. Mixing them into the root CLAUDE.md would dilute both specs.

### Scope for Phase 3

In: LLM-based candidate generation (M12), web-evidence-augmented generation (M13), candidate scoring against 7 dimensions × weights (M14), ranked-table UI with export (M15).

Out: candidate auto-discovery from RSS / news feeds (Phase 4), candidate enrichment via Crunchbase / PitchBook APIs (Phase 4), Slack / email notifications (Phase 4), multi-user candidate review and approval (Phase 4).

---

## 2. The four Phase 3 milestones

| # | Milestone | What it ships | Status |
|---|---|---|---|
| **M12** | LLM-only candidate brainstorm | Single Opus call per venture produces 10-60 candidates with `{name, type, rationale, dimensions_implicated[]}`. Persisted to new `candidate_companies` table. Read-only `/ventures/[id]/candidates` page. Manual "Generate candidates" trigger. | ✓ Done 2026-05-15 |
| **M13** | Web-augmented brainstorm | Same candidate output shape, augmented with per-candidate `citations[]`. Each `implies_search_for` string becomes one Exa neural search; results bundle into a "## Web evidence" block; single Opus call produces an enriched candidate set. Migration 0004 adds `citations jsonb` to `candidate_companies`. M13 supersedes the M12-only path. | NEXT |
| **M14** | Parameter builder (Y-axis of comparison table) | Generates Tier 3 dynamic fact-collecting parameters per venture (10–20 params derived from `substitution_landscape` + `strategic_risks`). Tier 1 (universal, ~15) + Tier 2 (Innovera 7-dim spine, 21) are hardcoded. Output is the column schema for the downstream cell-research stage. Spec: `parameter_builder.md`. Migration 0006 adds `parameter_generation_runs` table + `parameters_generating`/`parameters_ready` statuses. | ✓ Done 2026-05-19 |
| ~~M14 (original scoring concept)~~ | ~~Scoring + weighting~~ | DEFERRED — the original M14 row described per-dim Likert scoring against the 7 venture dimensions (migration 0005's `dimension_scores jsonb` + `aggregate_score numeric` columns; P3-D14 through P3-D21). The parameter builder direction was chosen instead and shipped as M14. Scoring artifacts retained as a draft (see `M14_SPRINT_PLAN.md` banner). | Deferred to future milestone |
| M15 | Ranked-table UI + export | Sortable / filterable table at `/ventures/[id]/candidates` (replaces M12's simple list). CSV export. Optional: Notion / Slack share. | Pending M14 ship |

This is the "good that works → potentially great" sequencing. M12 ships a working pipeline. M13 makes it not-blind to regional players. M14 makes it actually ranked. M15 makes it usable in a meeting.

---

## 3. Architecture

```
                    PHASE 3 — END-TO-END DATA FLOW
                    ─────────────────────────────────

  /ventures/[id]/page.tsx                 [Phase 0-2 produces this state:
       │                                   status='ready', human_refined
       │ (status='ready' AND no              profile exists, dimension_weights
       │  candidate_companies rows yet)      set is canonical]
       ▼
  Button: "Generate competitor candidates"
       │
       ▼
  server action: triggerStage3Generation(ventureId)
       │
       ▼
  ┌──────────────────────────────────────────────────────────┐
  │  src/server/stage3-candidates.ts (M12)                   │
  │                                                            │
  │  1. requireUser + authed insforge client                  │
  │  2. status precondition check: must be 'ready'             │
  │  3. transition status → 'candidates_generating'             │
  │     (clears error_message)                                 │
  │  4. load latest human_refined profile_versions row         │
  │  5. load canonical dimension_weights set                   │
  │     (Pattern X: latest-per-dimension via fetch-all +      │
  │      reduce-in-JS; <100 sets per venture, fine for V1)    │
  │  6. assemble prompt: stage_3 body + profile + weights      │
  │  7. callLLM<Stage3CandidatesOutput>(reuse run_id)          │
  │  8. batch insert candidate_companies rows                  │
  │     with shared generation_run_id UUID                     │
  │  9. transition status → 'candidates_ready'                 │
  │ 10. redirect to /ventures/[id]/candidates                  │
  └──────────────────────────────────────────────────────────┘
       │
       │ M13 (later) plugs in here:
       │   between step 6 and step 7, each implies_search_for
       │   string becomes a web search; results get summarized
       │   into the prompt as evidence. Same output shape, same
       │   downstream consumers — M14/M15 don't know or care
       │   whether candidates came from M12 or M13.
       │
       ▼
  /ventures/[id]/candidates/page.tsx (M12)
       │
       │ Reads latest generation_run_id's candidates
       │ M14 will also read dimension_scores from candidate_companies
       │ M15 will replace this with a sortable table component
       ▼
  Card list (M12) → Sortable table (M15)
```

### State machine — `ventures.status` extension

```
                                                              user clicks
                                                              "Generate candidates"
  ┌──────────┐                                                          │
  │  ready   │ ◀─── (existing end-of-M11)                                │
  └─────┬────┘                                                          │
        │                                                                ▼
        │                                                    ┌─────────────────────┐
        │                                                    │candidates_generating│
        │                                                    └─────────┬───────────┘
        │                                                              │ stage3 ok
        │                                                              ▼
        │                                                    ┌──────────────────┐
        │                                                    │ candidates_ready │
        │                                                    └────────┬─────────┘
        │                                                              │
        │ (status='error' on any stage 3 failure; user can             │
        │  click Generate again to retry, which transitions             │
        │  back to candidates_generating)                               │
        ▼                                                              │
     error  ◀──────────────────────────────────────────────────────────┘
```

Migration 0003 adds `'candidates_generating'` and `'candidates_ready'` to the existing check constraint on `ventures.status`.

---

## 4. Data model

### New table: `candidate_companies` (migration 0003)

```sql
create table candidate_companies (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  profile_version_id uuid not null references profile_versions(id),
  -- generation_run_id groups the 10-60 candidates produced by a single
  -- Stage 3 call. Latest set wins in the UI; older sets are audit trail.
  generation_run_id uuid not null,
  name text not null,
  type text not null
    check (type in ('direct','category','same_problem_different_mechanism')),
  rationale text not null,
  -- Array of dimension names this candidate is most relevant to.
  -- M14 will add `dimension_scores jsonb` in migration 0004.
  dimensions_implicated text[] not null,
  -- Which LLM call produced this candidate. Foreign key into llm_call_logs
  -- so we can trace any surprising candidate back to its run.
  llm_call_id uuid references llm_call_logs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index candidate_companies_venture_idx
  on candidate_companies(venture_id, generation_run_id, created_at desc);
```

### RLS policy (non-negotiable)

```sql
alter table candidate_companies enable row level security;

create policy "candidate_companies: own venture" on candidate_companies
  for all
  using (
    exists (
      select 1 from ventures v
      where v.id = venture_id and v.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from ventures v
      where v.id = venture_id and v.created_by = auth.uid()
    )
  );
```

Mirrors the existing pattern for `profile_versions`, `dimension_weights`, etc. Without this, any user could read any candidate set. Migration 0003 MUST include this policy.

### Zod schema (M12)

```typescript
// src/types/candidate.ts

export const CandidateTypeSchema = z.enum([
  "direct",
  "category",
  "same_problem_different_mechanism",
]);

export const CandidateCompanySchema = z.object({
  name: z.string().min(1).max(200),
  type: CandidateTypeSchema,
  rationale: z.string().min(1).max(800),
  // Subset of the 7 dimension keys. The model picks 1-3 that best motivate
  // this candidate's relevance.
  dimensions_implicated: z.array(z.enum(DIMENSION_KEYS)).min(1).max(7),
});

export const Stage3CandidatesOutputSchema = z.object({
  candidates: z.array(CandidateCompanySchema).min(10).max(60),
  // Optional cross-set notes (e.g., "candidates skew toward US/EU due to
  // training data; expect M13 to surface regional players").
  generation_notes: z.string().max(800).optional(),
});

export type CandidateType = z.infer<typeof CandidateTypeSchema>;
export type CandidateCompany = z.infer<typeof CandidateCompanySchema>;
export type Stage3CandidatesOutput = z.infer<typeof Stage3CandidatesOutputSchema>;
```

Bounds rationale:
- `min(10)`: below this we treat it as a model failure and let callLLM's retry-once try again.
- `max(60)`: above this is noise; the UI gets unwieldy and M14 scoring gets expensive.
- `rationale` max 800 chars: ~3 sentences. Same calibration as Stage 1 critic comments.
- `dimensions_implicated` 1-7: at least one (otherwise the candidate isn't grounded), at most all (M12 model can over-claim relevance; M14 scoring will rationalize).

---

## 5. The Stage 3 prompt — high-level shape

Lives at `prompts/stage_3_candidate_generation.md`. Reads the human-refined profile + canonical dimension_weights set. Returns the schema above.

Key prompt directives:
- **The three categories** (Direct / Category / SPDM) defined verbatim from CLAUDE.md §2. Hard constraint: at least 5 of each type. Soft target: 10-15 of each.
- **Anti-anchoring:** the profile uses `[the parent]` for anonymization. Same rule applies to candidate brainstorming — if you know the venture is ABB, don't bias toward ABB-specific competitors that wouldn't be obvious from the synthesized description.
- **Use the load-bearing fields:** `substitution_landscape` for SPDM candidates, `implies_search_for` strings for the search-shape thinking.
- **Calibration:** for the ABB Rack PDU case, expect Schneider Electric, Eaton, Vertiv, Server Technology, Raritan in Direct. Expect Delta, CyberPower in regional adjacencies (M12 may miss; M13 catches). Expect busbar+tap-off and power-shelf vendors in SPDM.
- **No web search** at M12. The prompt is explicit that this is brainstorm-from-training-data; downstream Stage 4 (M13) will add web evidence.

---

## 6. Acceptance criteria for M12

**Placeholder** — to be defined per TODO #6 ("Stage 3 acceptance criteria"). Until that work lands, M12 acceptance is eyeball-only against the ABB venture:

- Returns 10-60 candidates that schema-validate
- Includes Schneider Electric, Eaton, Vertiv at minimum (the obvious incumbents)
- Includes at least 2 SPDM entries (busbar / power shelf / OCP-adjacent vendors)
- Each candidate has a rationale that references the venture profile (not generic)
- No candidate type fails the enum (no "Other" / "Mixed" / etc.)
- `dimensions_implicated[]` is non-empty for every candidate

Section §13-equivalent assertions will be added to `evals/criteria.ts` once the acceptance TODO is resolved.

**M12 ship result (2026-05-15 ABB run):** 48 candidates (15 Direct / 16 SPDM / 17 Category), $0.26 spend, 113.6s latency. All six §6 hits cleared on first run. Full result captured at `test-cases/abb-rack-pdu/m12_baseline.json` (to be committed) for M13 regression comparison.

---

## 6b. M13 — Web-augmented brainstorm

Same candidate shape, augmented with per-candidate citations sourced from a deterministic web-search step that runs before the Opus call.

### Architecture changes

```
   ┌─────────────────────────────────────────────────────┐
   │  stage3-candidates.ts (M13)                          │
   │                                                       │
   │  Steps 1-5 unchanged (claim + load profile + weights) │
   │                                                       │
   │  6a. NEW: for each strategic_risks_and_uncertainties  │
   │      [].implies_search_for, run one Exa neural search │
   │      (parallel). 6 risks → 6 searches → ~30-60 hits.  │
   │                                                       │
   │  6b. NEW: normalize hits — keep {url, title, text}    │
   │      where text is the Exa-returned snippet (~500     │
   │      chars). Bundle as a "## Web evidence" block      │
   │      indexed by source query.                          │
   │                                                       │
   │  6c. Assemble prompt: stage_3 body + profile + weights│
   │      + web evidence block.                            │
   │                                                       │
   │  7. callLLM — single Opus call (P3-D10), same         │
   │     Stage3CandidatesOutputSchema but now each         │
   │     candidate may carry `citations[]`.                │
   │                                                       │
   │  7a. NEW: within-run de-dup. The model may surface    │
   │      the same company under multiple search-result    │
   │      sets; case-fold name match, keep the first       │
   │      occurrence, merge citations.                     │
   │                                                       │
   │  Steps 8-10 unchanged (insert + transition + redirect)│
   └─────────────────────────────────────────────────────┘
```

### Schema additions (migration 0004)

```sql
alter table candidate_companies
  add column citations jsonb;

-- Element shape (Zod-enforced; check constraint kept loose because the
-- model-emitted JSON is already schema-validated by callLLM):
--   { url: string (URL), title: string, query: string }
-- Per-candidate cap: 0-3 entries. NULL on candidates that came from
-- training data only (no web hit grounds them).
```

The `CandidateCompanySchema` gets an optional `citations` field:

```typescript
const CitationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(300),
  // The implies_search_for string that produced the hit, so a reader
  // can trace a citation back to the venture risk that motivated it.
  query: z.string().min(1).max(500),
});

// In CandidateCompanySchema, append:
citations: z.array(CitationSchema).max(3).optional();
```

### Exa client

`src/lib/exa/search.ts` — thin wrapper around `POST https://api.exa.ai/search` with `{ query, type: "neural", numResults: 5-10, contents: { text: true } }`. Requires `EXA_API_KEY`. Returns parsed `{ results: { url, title, text }[] }`.

Per-call timeout: 15s. Sequential or `Promise.all` parallel — pick parallel for the 6-search batch to keep latency under 5s for the web phase.

### Prompt additions

`prompts/stage_3_candidate_generation.md` gets a new section:

> **# WEB EVIDENCE (M13)**
>
> Below the profile and weights, a `## Web evidence` block contains real search results from neural web search, one set per `implies_search_for` string. Each result has a URL, title, and ~500-char snippet.
>
> Use evidence as ground truth: candidates surfaced in evidence are higher-priority than candidates from training data alone. **For every candidate that maps to one or more evidence entries, attach a `citations` array of up to 3 entries.** Each citation must use the exact `url` and `title` from the evidence block plus the `query` (the `implies_search_for` string) the result came from.
>
> If a candidate has no evidence backing, omit `citations` for that candidate — do not invent URLs. Training-data candidates without citations remain valid.
>
> The web evidence may surface regional players (Chinese, Indian, etc.) that the M12 anti-hallucination guard kept you from naming. Now you have evidence — include them with citations.

### Cost + latency projection

| Phase | Estimated cost | Estimated latency |
|---|---|---|
| Exa searches (6 × neural) | ~$0.03–$0.06 | ~3–5s parallel |
| Opus call (input grows by ~15k tokens) | ~$0.35–$0.50 | ~120–150s |
| **Total M13 run** | **~$0.40–$0.55** | **~130–155s** |

Still well under D4's $5/run budget cap. Bump `STAGE_3_TIMEOUT_MS` only if needed; 180s should still fit.

### M13 acceptance criteria

**Venture-agnostic by design (P3-D13, 2026-05-19).** Each criterion below is evaluable for any venture's Stage 3 output without hardcoding company names; venture-specific operationalization (which names a given run must surface) lives in per-case `test-cases/<case-id>/expected_candidates.json` fixtures (TODO #7). The ABB fixture is the keystone reference, but the framework applies unchanged to any future Innovera venture.

1. **Direct shelf — floor + baseline preservation.**
   - Floor: ≥5 Direct candidates (matches CRITICAL CONSTRAINTS #1 in the prompt).
   - Baseline preservation: when a prior `generation_run_id` exists for the same `profile_version_id`, every Direct candidate in the baseline reappears in this run by case-folded `name` (regression test). For ABB the baseline is `test-cases/abb-rack-pdu/m12_baseline.json`; future ventures get their own baseline on first ship.

2. **SPDM archetype completeness — the substitute for hardcoded SPDM names.**
   - Every entry in `dimensions.product_solution.substitution_landscape[]` is represented by ≥1 SPDM candidate whose `rationale` references the entry (substring match on the entry's keyword set is sufficient — e.g., a `substitution_landscape` entry naming "busway / busbar overhead distribution with per-rack tap-off units" is satisfied by any candidate whose rationale contains `busbar`, `busway`, or `tap-off`).
   - Floor: ≥5 SPDM candidates total.
   - This generalizes: any venture's `substitution_landscape` becomes its own SPDM checklist. Dropping a substitution archetype because Exa returned no hits for it is the M13 regression mode this criterion guards against (see P3-D13 root-cause).

3. **Web-search lift — new candidates with evidence.**
   - ≥3 candidates present in this run AND not in the baseline (when a baseline exists) AND carrying ≥1 citation each.
   - Conditional: where `geography_regulatory.accessible_market_constraints[]` names a constrained market, ≥1 candidate operating in that market appears with evidence backing. For ABB this means a named China-market specialist beyond Huawei/Inspur; for ventures with no geographic constraints this sub-criterion is N/A.

4. **Citation rate on the categories the searches target.**
   - ≥50% of Direct + SPDM candidates carry ≥1 citation.
   - Category candidates are excluded from the denominator: the six `implies_search_for` queries target Direct and SPDM archetypes by construction, so requiring citations on Category candidates would push the model toward fabricated URLs.

5. **Within-run de-dup** — no two candidates share a case-folded `name`.

6. **Cost cap respected** — total Stage 3 cost (Exa searches + Opus call) stays under $1.

7. **Anonymization preserved (NEW).** No candidate `name` matches the venture's parent or one of the parent's divisions / product lines. M12 baseline violated this for the ABB run by listing ABB Smart Power / ABB TruONE / ABB Electrification as competitors; M13 correctly dropped two of three. The criterion exists so future ventures don't reintroduce the leak, and so the prompt's Constraint 4 has a corresponding gate.

---

## 7. LLM call conventions (carried forward from CLAUDE.md §12)

Stage 3 uses the same `src/lib/openrouter/call.ts` wrapper as Stages 1 and 2:
- Default model: `anthropic/claude-opus-4.7` (configurable via `STAGE_3_MODEL` env var)
- Timeout: 180s. Input is ~8-10k tokens (profile + weights + prompt body); output is the bigger driver at 4-5.5k tokens for a 36-45 candidate brainstorm with ~500-char rationales. At Opus 4.7's sustained generation rate, pure streaming time is 100-140s, so we need Stage 1's 180s budget here — 90s cut off mid-stream on the first ABB run (2026-05-15).
- Stage tag: `stage_3_candidates` in `llm_call_logs`
- Run ID: reuse `ventures.current_run_id` so the $5 cap (D4) covers Stages 1+2+3 together
- Validation retry: existing callLLM retry-once handles JSON drift

Estimated cost: ~$0.20-0.40 per Stage 3 call. Total venture lifecycle (1+2+3) stays under $1.

---

## 8. Things to NOT do (Phase 3 V1)

- **Do not** add web search to M12. That's M13's whole point. Mixing them blurs the de-risking value of slicing.
- **Do not** score candidates in M12. Scoring is M14. A `score` field on `candidate_companies` at M12 invites the user to trust an uncalibrated number.
- **Do not** auto-chain Stage 3 from the M11 "Confirm weights" button. Manual button on `/ventures/[id]` until M14 makes the chain meaningful.
- **Do not** add candidate de-duplication logic in M12. The single-call shape doesn't need it. M13 with multiple search-shape calls will need it; build it then.
- **Do not** retry the full orchestrator on validation failure. callLLM's internal retry-once is sufficient; an outer retry burns budget for marginal lift.
- **Do not** persist the LLM's free-form `generation_notes` to `candidate_companies`. It's metadata about the call, not about a specific candidate. If we want it, add a separate `candidate_generation_runs` table later.

---

## 9. Decisions log (Phase 3-specific)

| # | Decision | Affects | Date |
|---|---|---|---|
| P3-D1 | M12 uses single Opus call (Approach A) over per-category fan-out (B) or self-critique pruning (C). | M12 orchestrator shape | 2026-05-15 |
| P3-D2 | HOLD SCOPE for M12 review — bulletproof the chosen plan rather than expand. | Review posture, downstream sections | 2026-05-15 |
| P3-D3 | Manual "Generate candidates" trigger on /ventures/[id], not auto-chain from M11 Confirm-weights. | UX flow, M11/M12 coupling | 2026-05-15 |
| P3-D4 | Weights handoff uses Pattern X (latest-per-dimension via fetch-all + reduce-in-JS). Pattern Y (explicit weights_run_id UUID) is the eventual model, captured as a TODO. | M12 read-side, M11 read-side, future migration | 2026-05-15 |
| P3-D5 | Concurrency guard: belt-and-braces — client-side disable via useTransition + server-side status precondition. | M12 server action + button UX | 2026-05-15 |
| P3-D6 | Eval framework hookup for Stage 3 deferred until acceptance criteria exist. M12 ships with vitest schema tests only. | M12 test surface, eval/runner.ts | 2026-05-15 |
| P3-D7 | PHASE3.md written before M12 code lands. Spec-then-code playbook from Phase 0-2 carries forward. | This file, M12 implementation | 2026-05-15 |
| P3-D8 | After successful Stage 3, redirect user to /ventures/[id]/candidates. | UX flow | 2026-05-15 |
| P3-D9 | M13 web search via Exa (neural mode), not Firecrawl or Serper. Exa's semantic ranking outperforms keyword search on "companies that ship X" queries; Firecrawl's strength is multi-step scraping, which M13 doesn't need. | M13 search provider, new env var EXA_API_KEY | 2026-05-15 |
| P3-D10 | M13 uses a single Opus call with all 6 search-result sets bundled as web evidence, not per-risk LLM fan-out. ~6x cheaper, lets the model cross-reference evidence across risks. Context budget has ~150k tokens of headroom; not a concern. | M13 orchestrator shape, prompt assembly | 2026-05-15 |
| P3-D11 | Citations stored as a `jsonb` column on `candidate_companies` (migration 0004), not a separate `candidate_citations` table. Atomic with the candidate row; M14/M15 don't query citations independently. If a future milestone needs citation-source analytics, lift to a table then. | Migration 0004, schema, candidate UI | 2026-05-15 |
| P3-D12 | M13 supersedes the M12-only code path rather than coexisting. The M12 ABB baseline is preserved as a frozen test fixture (`test-cases/abb-rack-pdu/m12_baseline.json`) for regression comparison; runtime keeps only the M13 (web-augmented) path. | Orchestrator structure, dead code policy | 2026-05-15 |
| P3-D13 | M13 §6b acceptance criteria reframed as venture-agnostic shelf-coverage tests, not hardcoded ABB names. SPDM coverage moves from a hardcoded must-have list (Vicor / Atom Power / ABB TruONE / NVIDIA) to "every `substitution_landscape[]` entry must be represented by ≥1 candidate by keyword match." Citation-rate denominator narrowed to Direct + SPDM (the categories Exa queries target). New criterion 7 (anonymization preserved) closes the M12 ABB Smart Power / ABB TruONE leak that §6b previously made a must-have. Root cause of the original framing: §6b was drafted from the M12 ABB baseline contents rather than from the profile structure that generalizes across ventures. | §6b acceptance criteria, expected_candidates.json fixture shape (TODO #7), prompt Constraints 4 + 5 | 2026-05-19 |
| **DEFERRED set** | **P3-D14 through P3-D21 describe a per-candidate scoring milestone that was planned 2026-05-19 (via `/plan-ceo-review` + `/plan-eng-review` on `M14_SPRINT_PLAN.md`) but DEFERRED in favor of the parameter builder direction shipped as the actual M14.** Migration 0005's columns remain on `candidate_companies` dormant. These decisions are retained because the scoring path is a viable future milestone and the architecture work is sound. | Whole row below is informational, not in-force | 2026-05-19 |
| P3-D14 | M14 scoring call shape: single Opus 4.7 call covering all candidates × all 7 dimensions inline (Option A). Rejected per-candidate fan-out (53 calls × Opus, $3–5, hits budget cap) and Sonnet-first-pass / Opus-refinement two-stage (no M13 precedent, premature optimization). Matches M12 + M13 pattern; diffuse-attention risk mitigated by SELF-AUDIT step in prompt (inheriting M13 §6b fix). Estimated $0.70–1.00, ~150s per run. | M14 orchestrator shape, prompt assembly, cost projection | 2026-05-19 |
| P3-D15 | M14 score scale: Likert 1–5 per (candidate, dimension) cell with single-sentence rationale and per-row confidence (Option A). Rejected discrete `none/weak/medium/strong/dominant` enum (harder to sort, no real cost saving) and 0.0–1.0 float (false precision the model can't reliably deliver). 5 = perfect competitive overlap; 1 = no meaningful overlap. Standard consulting rubric; rationale enables M15 hover-reveal of scoring reasoning. | Zod schema for Stage 4, prompt output format, M15 UI affordances | 2026-05-19 |
| P3-D16 | M14 aggregation formula: weighted sum `aggregate = Σᵢ(scoreᵢ × weightᵢ)` (Option A). Range 1–5 since dimension weights sum to ≈1. Rejected weighted geometric mean (over-penalizes weak dims, not consulting-standard) and top-3-weighted-dims average (discards signal from low-weight dims). Computed in the orchestrator at insert time, persisted to `aggregate_score` column for cheap sorting in M15. | Orchestrator post-LLM step, candidate_companies schema (migration 0005 column shape), M15 sort key | 2026-05-19 |
| P3-D17 | M14 evidence sourcing: profile + weights + candidate name + rationale + citations metadata, no re-fetch (Option A). Rejected per-candidate Exa re-searches (added latency + cost, no obvious lift) and name-only stripped-rationale (discards M13's grounded reasoning). M13 already paid the Exa cost; Stage 4 builds on that ground truth rather than re-paying. | M14 prompt input assembly, no new external API surface in M14 | 2026-05-19 |
| P3-D18 | M14 `aggregate_score` persisted as a separate `numeric` column on `candidate_companies` alongside `dimension_scores jsonb` (migration 0005), with an index on `(venture_id, aggregate_score DESC)` for M15's sort path. Rejected embedding inside the jsonb (unindexed path query; would force sequential scan for sort) and recompute-on-read (closes door on filter-by-score-range queries; recomputes on every render). Tradeoff accepted: tiny denormalization (aggregate is derivable from dimension_scores) is the price of cheap ORDER BY in M15. Orchestrator computes aggregate in JS at insert time after Zod validation. Surfaced via `/plan-ceo-review` Section 1 D1, 2026-05-19. | Migration 0005 column shape, M14 orchestrator post-LLM step, M15 sort query | 2026-05-19 |
| P3-D19 | M14 Stage 4 output schema strictly enforces one scored entry per input candidate. `Stage4ScoringOutputSchema` adds a Zod refinement that `output.scores.length === input.candidates.length` (matched by case-folded candidate `name`). Missing any candidate triggers `LLMValidationError` → `callLLM` retry-once → hard-fail to `status='error'` if still missing. Rejected graceful degradation (would add a `partially_scored` status enum value, relax the §6c coverage floor, and accumulate UI surface for a hypothetical failure mode); rejected defer-and-revisit (if the failure fires on first ABB run, the iteration cycle pays for the deferral). Matches PHASE3.md §6b criterion 1 "coverage floor" no-silent-failure principle. Surfaced via `/plan-ceo-review` Section 2 D2, 2026-05-19. | Stage4ScoringOutputSchema definition, orchestrator error path, §6c criterion 1 wording | 2026-05-19 |
| P3-D20 | M14 migration 0005 creates a composite index `(venture_id, generation_run_id, aggregate_score DESC)` on `candidate_companies`, not a simple `(venture_id, aggregate_score DESC)`. M15's read path filters by `generation_run_id` (latest run only; older sets are audit trail per §4) and orders by `aggregate_score DESC` — the composite covers the full query in one index scan with no post-fetch filter. Rejected: simple two-column index (requires WHERE filter post-scan) and two-separate-indexes (doubles write-time maintenance for no proportional read benefit at V1 single-user scale). Surfaced via `/plan-eng-review` Section 1 D1, 2026-05-19. | Migration 0005 DDL, M15 sort query shape | 2026-05-19 |
| P3-D21 | M14 Stage 4 persists scores via a single SQL UPDATE with `CASE WHEN id=... THEN ... END` clauses keyed by candidate id, not 53 individual UPDATEs (transaction-wrapped or otherwise). Atomic, one DB round-trip, zero race window for M15 concurrent reads. Rejected: transaction-wrapped N-updates (functionally atomic but 53× round-trips, slower) and bare N-updates (race window with M15 readers — real correctness gap even at single-user V1 scale, where the window is microseconds but the failure mode is silent partial-state reads). Statement shape: `UPDATE candidate_companies SET dimension_scores = CASE id WHEN $1 THEN $2::jsonb WHEN $3 THEN $4::jsonb ... END, aggregate_score = CASE id WHEN $1 THEN $5::numeric ... END WHERE id IN ($1, $3, ...)`. Surfaced via `/plan-eng-review` Section 1 D2, 2026-05-19. | M14 orchestrator DB write step, race-condition correctness | 2026-05-19 |

---

## 10. NOT in scope (Phase 3 V1)

| Deferred to | Item | Why |
|---|---|---|
| M14 | Per-dimension scoring of each candidate | Requires acceptance criteria and a separate LLM eval pass; M13 produces evidence-backed candidates, M14 ranks them |
| M14 | `dimension_scores: jsonb` column on candidate_companies | Migration 0005's job once M14 starts (0004 is M13's `citations` column) |
| M15 | Sortable / filterable table UI; CSV export | M13 still ships a card list (with citation links); sorting needs scores which don't exist until M14 |
| Phase 4 | Auto-discovery from RSS / news feeds | Out of band; requires monitoring infrastructure |
| Phase 4 | Crunchbase / PitchBook API enrichment | Out of band; requires per-vendor data agreements |
| Phase 4 | Slack / email notifications when candidates ready | Out of band; multi-user workflow primitive |

---

## 11. Build order

### M12 (shipped 2026-05-15) — for reference

1. ✓ Migration 0003 — table + status enum + RLS policy.
2. ✓ Zod schema at `src/types/candidate.ts` + round-trip tests.
3. ✓ Prompt at `prompts/stage_3_candidate_generation.md`.
4. ✓ Orchestrator at `src/server/stage3-candidates.ts`.
5. ✓ Server action `triggerStage3Generation`.
6. ✓ Detail page integration with "Generate candidates" button.
7. ✓ List page at `/ventures/[id]/candidates/page.tsx`.
8. ✓ ABB end-to-end run, §6 criteria cleared.

### M13 (NEXT)

1. **Freeze M12 baseline** — export the current ABB `candidate_companies` set to `test-cases/abb-rack-pdu/m12_baseline.json`. This is the regression-comparison fixture for M13 acceptance §6b.
2. **Migration 0004** — add `citations jsonb` to `candidate_companies` (nullable; no check constraint — Zod enforces shape at insert).
3. **Zod schema** — extend `CandidateCompanySchema` with optional `citations` field per §6b. Round-trip tests.
4. **Exa client** at `src/lib/exa/search.ts` — POST wrapper with timeout + error class hierarchy mirroring `src/lib/openrouter/call.ts`.
5. **Prompt update** at `prompts/stage_3_candidate_generation.md` — append the WEB EVIDENCE section directive. Existing M12 calibration block stays unchanged.
6. **Orchestrator update** at `src/server/stage3-candidates.ts`:
   - Add web-evidence step between input load and `callLLM`.
   - Add within-run de-dup before `insertCandidates`.
   - Thread citations through to the insert.
   - Remove the "no web evidence" code path per P3-D12.
7. **Candidates page update** at `/ventures/[id]/candidates/page.tsx` — render citation links under each candidate's rationale when present. Small unstyled list; no separate badge.
8. **ABB end-to-end run**, eyeball against §6b acceptance criteria.

Estimated effort: ~4-6 hours human / ~45-90 min CC. Smaller than M12 because the orchestrator + UI scaffolding already exists.

---

*Last updated: 2026-05-19 (M13 shipped; M14_SPRINT_PLAN.md drafted; both `/plan-ceo-review` and `/plan-eng-review` cleared in HOLD SCOPE mode; M14 decisions locked as P3-D14 through P3-D21). Authors: Harry (build lead), with Claude as planning collaborator. See PLAN.md for milestone status, M14_SPRINT_PLAN.md for current sprint, root CLAUDE.md for Phase 0-2 spec, DESIGN.md for visual system, TODOS.md for open follow-ups.*
