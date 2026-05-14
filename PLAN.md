# VentureX — Implementation Plan (Phases 0-2)

**Status:** M1-M6 + auth complete. M7 (Stage 1 extraction orchestrator) is next.
**Generated:** 2026-05-14 from `/plan-eng-review`
**Last updated:** 2026-05-14 (post-M4 end-to-end working)

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
| **M7** | **Stage 1 extraction** | **NEXT** | The load-bearing call. Acceptance gate = Section 13 criteria on ABB |
| M8 | Stage 1 critic | Pending | Needs M7 |
| M9 | HITL refinement UI | Pending | Needs M8 |
| M10 | Stage 2 weighting | Pending | Needs M9 |
| M11 | Eval framework + Weights UI + E2E test | Pending | Needs M10 |

**10 tests passing.** `pnpm test:run` is green.

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

## What's pending — M7-M11

### M7 — Stage 1 extraction (the load-bearing call)

**Deliverables:**
- `src/server/stage1-extract.ts` that:
  1. Loads venture + all `venture_documents.parsed_markdown` from DB
  2. Reads `prompts/stage_1_profile_extraction.md` at runtime (per claude.md Section 8 — no hardcoded prompts)
  3. Assembles input per Section 8's "Input assembly" block (description + each doc as `## Document: filename` blocks)
  4. Generates a `run_id` UUID for budget tracking (D4)
  5. Calls `callLLM` with `schema: VentureProfileSchema`, `expectJson: true`, `stage: "stage_1_extract"`, the new `run_id`, and 180s timeout
  6. On success: inserts a `profile_versions` row with `source: 'llm_extracted'` via `insertProfileVersion` (D6 wrapper) — `version_number = 1`
  7. On error: transitions venture `status='error'` with `error_message` populated; does not silently retry
- Either a server action triggered after M4's upload completes, or a route handler invoked by a small "Run Stage 1" button on `/ventures/[id]` (pick the simpler one — server action chained off the upload is probably cleanest)

**Acceptance — primary gate:** Running on the ABB fixture produces a profile that hits Section 13 criteria:
- `dimensions.product_solution.substitution_landscape` includes busbar/tap-off, power shelves, DC distribution, in-rack DC, integrated server-mounted power
- `strategic_risks_and_uncertainties` includes the 100-200kW migration risk and the AC-to-DC transition risk, each with non-empty `implies_search_for`
- `dimensions.geography_regulatory.accessible_market_constraints` mentions the China $500M / $75M gap
- `dimensions.capital_asset.capital_intensity === 'high'` and `asset_type === 'hardware'`
- `dimensions.customers.segment_type` is `B2B-Enterprise` or `mixed`
- `synthetic_description` does not contain "ABB"

**Do not move on to M8 until this passes.** Expect 2-4 cycles of prompt iteration.

**Est:** CC ~4 hours of code + prompt iteration time

### M8 — Stage 1 critic with D3 retry-soft-fail
- Draft `prompts/stage_1_critic.md` (~1 hour, separate task)
- `src/server/stage1-critic.ts` — different model family per env (`STAGE_1_CRITIC_MODEL` default `openai/gpt-5.5`)
- D3 retry logic: try once → 30s wait → retry → on second failure set `venture.critic_status='unavailable'` and continue
- Insert `profile_versions` row with `source='llm_critic'` on success
- Transition to `awaiting_refinement` regardless of critic outcome

### M9 — HITL refinement UI at `/ventures/[id]/refine`
- Client Component (claude.md Section 10 explicit: not Server Components)
- Per-dimension panel with inline edit + supporting quotes + critic flag display
- Array editors for `substitution_landscape` and `strategic_risks_and_uncertainties` (load-bearing fields, ergonomics matter)
- "Save dimension" creates a new `profile_versions` row via `insertProfileVersion`
- D3 banner when `critic_status === 'unavailable'`
- "Confirm to continue" → status `weighting`, triggers M10

### M10 — Stage 2 weighting
- Draft `prompts/stage_2_dimension_weighting.md`
- `src/server/stage2-weight.ts` — Opus 4.7 on latest `human_refined` profile
- Renormalize if sum ∈ [0.95, 1.05]; throw outside
- Insert 7 `dimension_weights` rows with `source='llm_proposed'`

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

## Parallelization map (mostly historical now — M2-M6 are done)

The remaining work M7→M8→M9→M10→M11 is largely sequential because each depends on the prior step's output. No meaningful parallelization opportunity left.

The one exception: **drafting `prompts/stage_1_critic.md` and `prompts/stage_2_dimension_weighting.md`** can happen in parallel with M7 implementation — prompts are text, not code, and don't block compilation. Two short Markdown writes; budget ~1 hour each.

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
| Stage 1 critic | Both attempts fail (D3) | Pending M8 | Soft-fail, set `critic_status='unavailable'` | Yellow banner in HITL |
| HITL save | Concurrent inserts (D6) | Pending M9 | Retry-on-conflict up to 3x | Invisible to user |
| Stage 2 weight | Sum outside [0.95, 1.05] | Pending M10 | Throw with clear error | Error page |
| Storage upload | File too large or storage error | Yes (M4) | Per-file error, continue with others | Per-file UI feedback |

No critical gaps flagged (every new codepath has at least one of: test / error handling / user signal).

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
**VERDICT:** ENG CLEARED — M1-M6 + M4 shipped. M7 is the next milestone and the load-bearing acceptance gate.
