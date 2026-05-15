# VentureX — Implementation Plan (Phases 0-2)

**Status:** M1-M10 complete (HITL UI shipped, M10 wire-up live in `confirmRefinement`). M11 (eval framework + weights UI + e2e test) in flight on a parallel Claude Code terminal. M12 (Phase 3 kickoff) under design.
**Generated:** 2026-05-14 from `/plan-eng-review`
**Last updated:** 2026-05-15 (post-M10 chain — confirmRefinement → runStage2Weighting wired, DESIGN.md ratified)

This is the working execution plan. `claude.md` remains the spec. This plan tracks decisions, milestone status, and what's left.

---

## Milestone status

| # | Milestone | Status | Notes |
|---|---|---|---|
| **M1** | Scaffold + cleanup | ✓ Done | Next.js 16 + React 19 + Tailwind 4 + InsForge per D8 |
| **M2** | DB schema + clients + D6 wrapper | ✓ Done | Migrations 0001 (schema) + 0002 (storage RLS). InsForge clients in `src/lib/insforge/{server,browser}.ts` |
| **M3** | Stage 0 parsers | ✓ Done | PDF + DOCX + dispatcher. 3 tests passing. PPTX rejected per D2 |
| **M4** | Upload flow + auth | ✓ Done | `/ventures/new` + `/ventures/[id]` + login pages. OTP email verification per D9 |
| **M5** | Zod schema | ✓ Done | `src/types/venture-profile.ts` + 7 round-trip tests against ABB fixture |
| **M6** | OpenRouter wrapper | ✓ Done | `src/lib/openrouter/call.ts` with budget enforcement (D4) and retry-once (D1) |
| M7 | Stage 1 extraction | ✓ Done | `src/server/stage1-extract.ts`. Section 13 ABB acceptance gate cleared after 4 prompt-iteration cycles (see D10) |
| M8 | Stage 1 critic | ✓ Done | `src/server/stage1-critic.ts` + `prompts/stage_1_critic.md`. D3 retry-soft-fail in place. End-to-end on ABB returned valid `Stage1CriticOutput` in 1.9s (gpt-5.5). See M8 calibration note below |
| M9 | HITL refinement UI | ✓ Done | `src/app/ventures/[id]/refine/` — full 7-dimension + top-level panels. Load-bearing emphasis on `substitution_landscape` and `strategic_risks_and_uncertainties`. Always-active save with "Mark reviewed" / "Save dimension" duality. Inline critic flags per field |
| M10 | Stage 2 weighting | ✓ Done | `src/server/stage2-weight.ts` + `prompts/stage_2_dimension_weighting.md` + `confirmRefinement` chain. End-to-end on ABB passed all 5 §13 weight criteria first cycle. Sum-renormalize [0.95, 1.05] → 1.0; outside throws |
| **M11** | **Eval framework + Weights UI + E2E test** | **Eval framework ✓ Done; Weights UI + e2e remain** | `evals/criteria.ts` + `evals/runner.ts` + `evals/run.ts` shipped. `pnpm tsx --env-file=.env.local evals/run.ts` runs Stage 1 + Stage 2 live against the ABB case in ~3-5s for $0.20-0.30 and prints structured PASS/FAIL per Section 13 criterion. Weights UI at `/ventures/[id]/weights` still TODO |
| M12 | Phase 3 kickoff (TBD) | Pending design | Candidate generation. See "M12 strategy" section below |

**25 tests passing.** `pnpm test:run` is green. `tsc --noEmit` is clean. Test files: `venture-profile` (7) + `venture-profile-critic` (6) + `venture-profile-weighting` (9) + `parsers` (3).

### M8 calibration follow-up

Running the critic against `expected_profile.json` produced **38 flags** (30 per-dim + 8 top-level) — well above the CLAUDE.md §9 calibrated band of 4-15. Two reads:

1. The expected profile is the hand-curated gold standard with extrapolation beyond literal doc evidence (e.g., enumerated distribution channels, key suppliers, `time_to_revenue_years`). The critic correctly flags these as "unsupported" because the cited quotes don't establish them.
2. In production the critic reads an LLM-extracted profile that grounds claims in `supporting_quotes[]`. Flag count there should be substantially lower.

Open question parked for M9 dogfood: tune the prompt to soften `unsupported` flags on fields the schema explicitly invites extrapolation for, or accept the higher count and trust HITL to filter. Don't iterate the prompt until we have a real extracted profile to point it at (M11 eval framework gives us that loop).

---

## Decisions

| # | Decision | Affects |
|---|---|---|
| D1 | Profile schema: nested `dimensions: {}` wrapper. Top-level `venture_codename`. | Zod schema, prompts, HITL UI bindings, DB JSONB paths |
| D2 | Drop PPTX from V1. Stage 0 rejects `.pptx` with "convert to PDF first" message. | Stage 0, deferred scope |
| D3 | Stage 1 Critic failure: retry once with 30s gap, then soft-fail with yellow banner in HITL UI. | Stage 1 Critic logic, HITL UI |
| D4 | Budget cap: per-run, $5 covers one Stage 1 + critic + Stage 2 cycle. Re-runs reset to $0. | OpenRouter wrapper, error UX |
| D5 | Reorganize `promp-examples/` → `prompts/` + `test-cases/abb-rack-pdu/` per CLAUDE.md Section 6. | Repo layout |
| D6 | `profile_versions` concurrency: retry-on-conflict wrapper around inserts. Catches Postgres 23505, retries up to 3 times. | DB write layer |
| D7 | LLM eval framework in scope for Phases 0-2. `evals/` directory with runner, Section 13 criteria as assertions. 2nd test case = P1 follow-on. | New scope addition; build step M11 |
| **D8** | **Switch backend from Supabase to InsForge** (2026-05-14, user-driven). | All DB code, RLS policies, env vars, auth flow |
| **D9** | **Email verification via 6-digit OTP code** (not magic link). 3-mode `/login` state machine: signin / signup / verify. Auto-jump from signup on `requireEmailVerification`, from signin on 403 unverified. | `src/app/login/*` |
| **D10** | **Prompt-tighten before schema-loosen** when Stage N output drifts. Schema is the downstream contract; prompt is the model interface. Loosen schema only on genuine shape miscast (e.g., field naturally a list, schema says string). Apply same triage in M8/M10. | Stage 1/2 iteration, future-stage drift |
| **D11** | **Design system ratified via `/design-consultation` (2026-05-15).** Memorable thing: "Serious software for serious work." IBM Plex Sans + Plex Mono, zinc neutrals, single indigo accent, load-bearing field emphasis (2px indigo left rule + elevated surface) on `substitution_landscape` and `strategic_risks.implies_search_for`. Always-active save with "Mark reviewed" vs "Save dimension" duality. Strict light/dark pairing on every color token (semantic CSS vars cover this). See `DESIGN.md`. | All UI, current + future |

### D10 (M7 iteration log — 4 cycles, 2026-05-14)

| Cycle | Issue | Fix type | Outcome |
|---|---|---|---|
| 1 | 4 Zod errors (margin_profile enum bleed, accessible_market_constraints shape, localization_requirements shape, time_to_revenue_years type) + content gap (capital_intensity=medium vs Section 13 needs high) | 3× prompt fix + 1× schema fix (`localization_requirements` string → array) | Validation green, Section 13 cleared 6/8 |
| 2 | Risks count 7 vs cap. Anonymization inconsistent. `access_intensity=medium` would push Stage 2 access weight above the ≤0.05 gate | 4× prompt fix + 2× schema cap (risks max 6, gaps max 5) | Risks=6, gaps=5, anonymization consistent. But over-consolidated AC-to-DC into 100–200kW risk; access_intensity flipped to "high" with channel-mattering rationalization |
| 3 | AC-to-DC risk merged with density risk (Section 13 hard fail). access_intensity=high (Section 13 weight-criterion soft fail) | 2× targeted prompt fix: (a) consolidation rule — distinct mechanisms stay distinct; (b) access_intensity decision tree — high only when access IS the moat | All 8 Section 13 criteria green. 6 distinct risks. access_intensity=low. M7 done |

Net: schema shape changed in 2 small places (localization_requirements; risks/gaps max caps tightened). All other fixes were prompt-only. Schema contract for downstream consumers preserved.

### D8 gotchas (captured in code; relevant for any future InsForge work)

- `@insforge/sdk` is the real package (the linter's `@insforge/insforge-js` was fictional)
- **`insforge.database.from(...)` is required** — not `insforge.from(...)` (Supabase shortcut)
- **`.insert([{...}])` requires array form** — InsForge does not accept a singular object
- **`auth.jwt() ->> 'sub'`** is the JWT helper; `auth.uid()` works on application tables but storage policies must use the JWT helper
- **Per-op storage policies** — `FOR ALL` does not work; need separate SELECT/INSERT/UPDATE/DELETE
- Storage schema differs: `bucket` (not `bucket_id`), `key` (not `name`), `uploaded_by` for ownership
- SSR: `createClient({ baseUrl, anonKey, isServerMode: true, edgeFunctionToken: accessToken })`; we manage cookies ourselves (`insforge_access_token`, `insforge_refresh_token`)
- InsForge `.ai` module is **deprecated** — use OpenRouter directly (which is what we do)

### D9 implementation summary

- `signUp()` returns `{ ok: true, requireVerification: true, email }` when project requires verification (no premature redirect)
- `signIn()` detects `statusCode === 403` or "not verified" message → returns `needsVerification: true` so UI jumps to verify mode
- `verifyEmail(email, otp)` calls `insforge.auth.verifyEmail`, sets cookies, redirects to `/`
- `resendVerification(email)` for "didn't get it" flow
- 6-digit OTP input has `inputMode="numeric"`, `autoComplete="one-time-code"` for mobile / OS autofill

---

## What's on disk

```
VentureX/
├── claude.md                          ← spec (source of truth)
├── PLAN.md                            ← this file
├── TODOS.md                           ← open follow-ups
├── README.md                          ← quickstart
├── package.json                       ← @insforge/sdk, no @supabase/*
├── tsconfig.json, next.config.ts, eslint.config.mjs, postcss.config.mjs
├── .env.example
├── prompts/
│   └── stage_1_profile_extraction.md  ← Stage 1 prompt (M7 will consume)
├── test-cases/abb-rack-pdu/
│   ├── expected_profile.json          ← gold-standard ABB output
│   └── (ABB source documents)         ← Harry to drop in if not already
├── insforge/migrations/
│   ├── 0001_initial_schema.sql        ← ventures, docs, versions, weights, logs + RLS
│   └── 0002_storage_policies.sql      ← venture-documents bucket RLS (InsForge syntax)
├── src/
│   ├── app/
│   │   ├── layout.tsx, page.tsx, globals.css
│   │   ├── login/
│   │   │   ├── page.tsx               ← signin / signup / verify state machine
│   │   │   └── actions.ts             ← signIn, signUp, verifyEmail, resendVerification, signOut
│   │   └── ventures/
│   │       ├── new/{page.tsx, form.tsx, actions.ts}
│   │       └── [id]/page.tsx
│   ├── lib/
│   │   ├── insforge/
│   │   │   ├── server.ts              ← createInsForgeServerClient + createAuthedServerClient
│   │   │   ├── browser.ts
│   │   │   └── auth.ts                ← getCurrentUser, requireUser, clearAuthCookies
│   │   ├── db/profile-versions.ts     ← D6 retry-on-conflict wrapper
│   │   ├── openrouter/
│   │   │   ├── call.ts                ← callLLM (budget + token + retry guardrails)
│   │   │   ├── errors.ts
│   │   │   └── pricing.ts
│   │   ├── parsers/
│   │   │   ├── pdf.ts, docx.ts, index.ts (dispatcher)
│   │   │   └── index.test.ts          ← 3 PPTX-rejection tests
│   │   ├── storage/upload.ts          ← uploadVentureDocument → InsForge Storage
│   │   └── utils.ts
│   ├── types/
│   │   ├── venture-profile.ts         ← Zod schema (D1 nested shape)
│   │   └── venture-profile.test.ts    ← 7 round-trip + D1 enforcement tests
│   ├── components/ui/.gitkeep         ← shadcn primitives go here when needed
│   └── server/.gitkeep                ← stage1-extract.ts etc land here (M7+)
└── vitest.config.ts
```

---

## What's pending — M10-M11

### M7 — Stage 1 extraction (the load-bearing call) — ✓ DONE 2026-05-14

Cleared Section 13 ABB acceptance in 4 iteration cycles (see D10 log). All 8 hard criteria green plus the `access_intensity = low` bonus that sets Stage 2 up to satisfy the access-weight ≤ 0.05 criterion. Server code at `src/server/stage1-extract.ts`, prompt at `prompts/stage_1_profile_extraction.md`, schema at `src/types/venture-profile.ts`.

### M8 — Stage 1 critic with D3 retry-soft-fail — ✓ DONE 2026-05-15

- `prompts/stage_1_critic.md` — drafted (per-dimension flags, 4 severities, hard caps)
- `src/server/stage1-critic.ts` — orchestrator with D3 retry: try once → 30s wait → retry → soft-fail to `critic_status='unavailable'`
- `src/types/venture-profile.ts` — `Stage1CriticOutputSchema` (4 severity enum, 7-dimension shape, ≤8 flags/dim, ≤10 top-level)
- `src/types/venture-profile-critic.test.ts` — 6 tests for the critic schema
- `src/app/ventures/[id]/actions.ts` — chains extraction → critic in one server action
- `src/server/stage1-extract.ts` — extraction now leaves `status='extracting'`; critic owns the transition to `awaiting_refinement`
- `scripts/check-critic.ts` — M8 acceptance helper that runs the critic against ABB without touching the DB
- E2E verification: critic returned valid output in 1.9s with 38 flags. Schema parsed clean. Calibration question parked (see M8 follow-up above)

### M9 — HITL refinement UI at `/ventures/[id]/refine` — in flight (parallel chat)

This chat does not own this milestone. State on disk: `page.tsx`, `actions.ts`, `refine-client.tsx`, `panel-primitives.tsx`, `panels/product-solution.tsx`. The parallel chat is iterating on UI/UX.

### M10 — Stage 2 weighting — ✓ DONE 2026-05-15 (server-side)

- `prompts/stage_2_dimension_weighting.md` — drafted, calibrated against §13 expectations
- `src/server/stage2-weight.ts` — orchestrator: load latest `human_refined` profile (fallback to `llm_extracted`), Opus 4.7 via `callLLM`, validate sum ∈ [0.95, 1.05] and renormalize to 1.0 (throw outside), insert 7 `dimension_weights` rows with `source='llm_proposed'`, reuse `current_run_id` for D4 budget tracking
- `src/types/venture-profile.ts` — `Stage2WeightingOutputSchema` (nested-by-dimension shape, weight ∈ [0,1], rationale ≤500 chars, optional synthesis_notes ≤600 chars)
- `src/types/venture-profile-weighting.test.ts` — 9 tests for the schema + sum-not-enforced-at-zod
- `scripts/check-stage2.ts` — M10 acceptance helper, runs Opus 4.7 against ABB profile and asserts §13 weight criteria
- E2E verification: 5/5 criteria pass first cycle (product_solution=0.260, capital_asset=0.220, geography_regulatory=0.180, access=0.040, sum=1.000). $0.055 cost, 2.7s latency.
- **Deferred:** wire-up from the HITL "Confirm to continue" button — touches `src/app/ventures/[id]/refine/actions.ts` which the M9 chat is iterating on. Plumb in after M9 stabilizes; the server action should call `runStage2Weighting` and route the user to `/ventures/[id]/weights` (M11)

### M11 — Eval framework + Weights UI + end-to-end test
- `evals/criteria.ts` — Section 13 criteria as assertion functions
- `evals/runner.ts` + `evals/run.ts` — `pnpm eval [case_id]`
- `/ventures/[id]/weights` UI — 7-bar visualization + sliders → `human_adjusted` rows
- Full pipeline run on ABB ends at `status='ready'` and eval CLI prints PASS

---

## NOT in scope (Phases 0-2)

| Deferred to | Item | Why |
|---|---|---|
| Phase 3 | Competitor candidate generation, web search (Exa/Serper), scoring, ranking, vector DB / RAG | Separate CLAUDE.md when we reach Phase 3 |
| Phase 4 | Team sharing / multi-user RLS | Single-user V1 per CLAUDE.md Section 16 Q1, resolved as "defer" |
| Phase 4 | PPTX support + vision OCR fallback | D2 |
| Phase 4 | Multi-user storage RLS — switch from owner-only (D8) to venture-JOIN pattern | When team-sharing lands, storage policies in 0002 need to swap from `uploaded_by =` to a JOIN through `ventures.created_by` |
| Phase 4 | Password reset flow | M4 covers signup + sign-in + OTP verification only. Reset is straightforward to add later via `sendResetPasswordEmail` + `exchangeResetPasswordToken` + `resetPassword` SDK methods |
| P1 follow-on | 2nd anonymized eval test case | D7 |
| P1 follow-on | LLM streaming responses | CLAUDE.md Section 12 explicit; synchronous V1 |

---

## Parallelization map (M1-M10 done; M11 running in a parallel terminal)

- **This terminal** owns design + bookkeeping + M12 strategy. Touched M9 panels, M10 chain wire-up, DESIGN.md, CLAUDE.md §17, this file.
- **Parallel terminal** owns M11: eval framework (`evals/criteria.ts`, `evals/runner.ts`, `evals/run.ts`), weights UI at `/ventures/[id]/weights`, and the end-to-end ABB pipeline run.

Shared surface to avoid double-editing:
- `src/app/ventures/[id]/page.tsx` — already has the "Open HITL refinement →" link; M11 likely adds an "Open weights →" link when status is `weighting` or `ready`. Coordinate before editing.
- `src/types/venture-profile.ts` — already locked. M11 reads `Stage2WeightingOutputSchema` + `DimensionWeightEntrySchema` but should not need to modify.
- `dimension_weights` table — M10 writes `llm_proposed` rows. M11 weights UI inserts `human_adjusted` rows on slider commits.

After M11 lands: M12 begins. See "M12 strategy" below for the proposal-stage thinking.

---

## Failure modes inventory (carried forward)

| Codepath | Realistic failure | Test? | Error handling? | User signal? |
|---|---|---|---|---|
| Stage 0 PDF parser | Encrypted PDF | Yes (M3) | Skip with error logged on doc row | Per-doc error visible |
| Stage 0 DOCX parser | Embedded images, format quirks | Yes (M3) | Skip images, continue | Logged warning |
| Stage 1 extract | Model returns prose instead of JSON | Yes (M6 retry) | Retry once with corrective prompt | Error if both fail |
| Stage 1 extract | Zod validation fails (missing field) | Yes (M6) | Same retry path | Error if both fail |
| Stage 1 extract | Token limit exceeded | Yes (M6) | `TokenLimitError` with copy | Helpful message |
| Stage 1 extract | Cost budget exceeded | Yes (M6) | `BudgetExceededError` | status='error', "Reset budget" CTA |
| Stage 1 critic | Both attempts fail (D3) | Covered by orchestrator structure; not exercised end-to-end yet (would need a flaky model) | Soft-fail, set `critic_status='unavailable'` | Yellow banner in HITL (M9) |
| HITL save | Concurrent inserts (D6) | Pending M9 | Retry-on-conflict up to 3x | Invisible to user |
| Stage 2 weight | Sum outside [0.95, 1.05] | Covered by `WeightSumOutOfRangeError` in orchestrator; not unit-tested (Zod doesn't enforce sum at schema layer per design) | Throw with clear error | Error page |
| Storage upload | File too large or storage error | Yes (M4) | Per-file error, continue with others | Per-file UI feedback |

No critical gaps flagged (every new codepath has at least one of: test / error handling / user signal).

---

## M12 strategy — Phase 3 kickoff (working draft, awaiting alignment)

**Premise:** CLAUDE.md scopes the current document at Phases 0-2. Phase 3 (candidate generation, web search, scoring, ranking) is explicitly deferred and is supposed to get its own CLAUDE.md when we reach it. After M11 lands, we are at that gate.

**The question is not "what comes next" — it's "how big should M12 be."** Four options:

### Option A — Pure-LLM candidate brainstorm (smallest first slice)
Take the `human_adjusted` profile + dimension_weights, prompt a frontier model to brainstorm 20-40 candidate competitors using `substitution_landscape` and `strategic_risks.implies_search_for` as seeds. No web search. No vector DB. Output is a list of `{name, type (direct/category/SPDM), one-line rationale, dimensions_implicated[]}`. Stored in a new `candidate_companies` table.

**Pros:** zero new external dependencies, lets us test prompt design + the profile→candidates handoff in isolation, gives a thing to look at within a week. **Cons:** candidates are limited to what the model knows from training; misses obscure regional players. Will need follow-on work.

### Option B — Web-search-augmented brainstorm (Exa or Serper integration)
Same as A but each `implies_search_for` string becomes a web search query. Hits are scraped/summarized, model is given the search results as evidence when proposing candidates.

**Pros:** dramatically wider candidate set, surfaces regional players and recent entrants invisible to the model's training, addresses your "web-based support" wish from earlier today. **Cons:** adds Exa/Serper API key + cost, brings in HTML parsing, rate-limiting concerns, citation/attribution UX.

### Option C — Operational polish on Phases 0-2 first (no Phase 3)
Sweep open TODOs: login + new-form dark-mode pass, second eval test case (TODO #2), password reset (Phase 4 backlog item), schema cross-walk with Pedram, possibly a `/health` dashboard. Hardens the current product before adding new scope.

**Pros:** turns a "works on ABB" product into a "works on any client venture" product. **Cons:** delays the actual differentiator (candidate generation) by 1-2 weeks. Doesn't address the user's web-research wish.

### Option D — Pre-Phase-3 contract definition (small but high-leverage)
Write a `Phase3InputBuilder` that packages the venture's canonical state (latest `human_refined` profile + `human_adjusted` weights) into a compact JSON contract suitable for any downstream Phase 3 implementation. Document the contract in a new `phase3-contract.md`. Optionally write a Phase 3 CLAUDE.md skeleton.

**Pros:** clean handoff between Phase 0-2 and Phase 3; lets us A/B different Phase 3 implementations (LLM-only vs web-augmented) against the same input contract. **Cons:** doesn't ship visible value; pure plumbing.

### Recommendation (subject to revision)
**A → then B as a follow-on**, with C deferred to a Phase 4 polish pass. Rationale:
- The user has explicitly named web research as a V2 wish, so B is on the line of sight, not Phase 4 distant.
- A is small enough to land as one milestone and gives a real artifact (a list of candidates per venture) you can show people.
- C work is real but lower-leverage than progress on the candidate pipeline.
- D is implicit in A — we'll naturally define the profile→candidate-prompt contract while building A.

This is a working draft. Before locking, surface back to the user for the choice. The Phase 3 CLAUDE.md gets written as part of M12 kickoff regardless of A/B/D path.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 9 issues resolved (D1-D9), scope held with adjustments |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** ENG CLEARED — M1-M10 shipped. Section 13 ABB acceptance gates cleared at both LLM-stage boundaries: M8 critic (38 flags, schema-clean) and M10 weighting (5/5 §13 weight criteria first cycle, sum normalized to 1.0). M9 HITL UI live with 7 dimension panels + top-level panel + load-bearing emphasis + always-active save. M10 chain wired through `confirmRefinement`. Design system ratified (DESIGN.md, D11). M11 (eval framework + weights UI + e2e) running in a parallel Claude Code terminal. M12 = Phase 3 kickoff, currently in design (see "M12 strategy" section above).
