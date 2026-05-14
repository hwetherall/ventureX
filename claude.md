# VentureX — Build Context for Claude Code

**Project:** VentureX (internal competitive landscape tool)
**Owner:** Innovera, Harry as build lead
**Scope of this document:** Phases 0–2 only (document intake, profile extraction, HITL refinement, dimension weighting). Candidate generation, scoring, and UI rendering are explicitly out of scope and will get their own CLAUDE.md when we reach them.

---

## 1. What you're building, and why

VentureX is the upstream half of an internal competitive-landscape system that replaces our reliance on Competely.ai for our consulting work. Competely is good at filling in cells once you give it logos; it is bad at picking the right logos. Picking the right logos *is* the hard problem in our consulting context, so we're building the picker.

The system takes a venture description (typically: a corporate innovation project — e.g., "a major electrical-equipment company's entry into rack-mounted power distribution for data centers") plus supporting documents, and produces a structured profile of that venture across **7 strategic dimensions**. That profile is then used downstream (Phase 3+, separate CLAUDE.md) to generate, score, and rank competitor candidates.

**Why this exists as its own subsystem rather than a single end-to-end call:** garbage in, garbage out. If the venture profile is wrong, every downstream step amplifies the error. Profile extraction is the highest-leverage step in the pipeline, and it gets human review before anything else fires.

### Scope for Phases 0–2

In: document upload, document parsing, LLM-based profile extraction, multi-model critic pass, HITL refinement UI, dimension weighting.

Out: competitor candidate generation, web search (Exa/Serper), scoring, ranking, output rendering, logo display, anything downstream of the weighted profile.

---

## 2. Domain glossary

Read this before anything else. The names and concepts here appear throughout the codebase.

- **VentureX:** The codename used for any venture inside the system. The profile and downstream pipeline must refer to the venture as "VentureX" rather than by the parent company's name, to prevent downstream LLM calls from over-anchoring on the parent's existing competitive set. Anonymization is **light** — "large industrial conglomerate with deep electrical-distribution expertise" is fine; we are not trying to hide identity from a determined human, only to prevent LLM models from pattern-matching on brand names.

- **The 7 Dimensions:** Product/Solution, Customers, Transaction, Partners, Access, Geography & Regulatory Surface, Capital/Asset Profile. These are the axes the profile is built around and the axes competitors will eventually be scored against. See section 8 for full definitions.

- **JTBD (Jobs to be Done):** Christensen framing. Lives inside the Product/Solution dimension. The functional + emotional + social job a customer hires the product for.

- **Substitution landscape:** Inside the Product/Solution dimension. Lists alternative *mechanisms* that could serve the same JTBD. This field is the bridge to downstream candidate generation — Phase 3's substitution-mechanism search queries are built from this field. **If this field is weak, the whole downstream pipeline fails on the keystone test case.** Treat it as load-bearing.

- **HITL (Human-in-the-loop):** Phase 1.5. After the LLM extracts the profile, a human reviews and refines it dimension by dimension before anything else runs. Non-negotiable.

- **Three competitor categories** (relevant later, defined here for shared vocabulary): Direct (same JTBD, same mechanism), Category (same mechanism, different JTBD), Same-Problem-Different-Mechanism (same JTBD, different mechanism). We killed the Adjacent Competitors category — do not reintroduce it.

- **Keystone test case:** ABB Rack PDU. Source materials are in `/test-cases/abb-rack-pdu/`. The system passes Phase 1 acceptance if it extracts a profile from those materials that correctly identifies the substitution risk (busbars, power shelves, DC distribution) as part of the Product/Solution dimension.

---

## 3. Architecture and data flow

```
[User uploads venture description + supporting docs]
            │
            ▼
   ┌────────────────┐
   │  Stage 0       │   Parse PDFs, DOCX → clean markdown. PPTX rejected.
   │  Intake        │   Store in InsForge. Generate venture_id.
   └────────────────┘
            │
            ▼
   ┌────────────────┐
   │  Stage 1       │   Single frontier-model call (Opus 4.7 default)
   │  Profile       │   produces structured 7-dimension JSON profile
   │  Extraction    │   with confidence scores and source quotes.
   └────────────────┘
            │
            ▼
   ┌────────────────┐
   │  Stage 1       │   Different frontier model (GPT-5.5 default) reads
   │  Critic        │   the profile and the source docs, flags weak
   │                │   dimensions, suggests improvements. Output stored
   │                │   alongside profile, NOT auto-applied.
   └────────────────┘
            │
            ▼
   ┌────────────────┐
   │  Stage 1.5     │   UI showing each dimension with source quotes,
   │  HITL          │   confidence score, and critic suggestions. User
   │  Refinement    │   edits any dimension and saves a new profile
   │                │   version. The saved version is canonical.
   └────────────────┘
            │
            ▼
   ┌────────────────┐
   │  Stage 2       │   Frontier-model call proposes weights across the
   │  Dimension     │   7 dimensions for THIS venture. User sees them
   │  Weighting     │   as a 7-bar visual and can adjust. Final weights
   │                │   stored on the profile version.
   └────────────────┘
            │
            ▼
[Profile ready for Phase 3 — out of scope for this CLAUDE.md]
```

Every box above logs its full input and output to InsForge. No black boxes; we need to be able to trace any surprising downstream output back to a specific LLM call.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Next.js 16 (App Router) | TypeScript, React Server Components |
| Hosting | Vercel | Standard Innovera deployment |
| Database & auth | InsForge | Postgres, RLS enabled, Storage for raw docs |
| LLM routing | OpenRouter | Lets us A/B model choices via config, not code changes |
| Primary models | Claude Opus 4.7 (extraction, weighting), GPT-5.5 (critic) | Frontier-tier only for Phases 1 & 2 — these are high-leverage |
| Document parsing | `pdf-parse` (PDF), `mammoth` (DOCX) | Output normalized to markdown. PPTX rejected in V1 per D2. |
| UI components | shadcn/ui + Tailwind | Standard |
| Validation | Zod | Every LLM JSON output validated against a Zod schema before storage |
| Forms | React Hook Form | For HITL editing |

**Do not introduce** other LLM SDKs, vector databases, embedding services, or search tools in this phase. They belong to Phase 3+ and adding them now creates dependency drift.

---

## 5. Database schema

Migration files live in `insforge/migrations/`. Below is the canonical schema for Phases 0–2.

```sql
-- Ventures: one row per venture analysis
create table ventures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  user_provided_description text not null,
  codename text not null default 'VentureX',
  status text not null default 'intake'
    check (status in ('intake','extracting','awaiting_refinement','weighting','ready','error'))
);

-- Documents: raw uploaded files attached to a venture
create table venture_documents (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  filename text not null,
  storage_path text not null,         -- InsForge Storage path
  mime_type text not null,
  parsed_markdown text,                -- populated after Stage 0
  parsed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Profile versions: every save is a new row, never UPDATE
create table profile_versions (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  version_number int not null,
  source text not null
    check (source in ('llm_extracted','llm_critic','human_refined')),
  profile_json jsonb not null,         -- the full 7-dimension profile
  llm_call_id uuid references llm_call_logs(id),
  created_at timestamptz not null default now(),
  unique (venture_id, version_number)
);

-- Dimension weights: one row per (venture, dimension) once Stage 2 runs
create table dimension_weights (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references ventures(id) on delete cascade,
  profile_version_id uuid not null references profile_versions(id),
  dimension text not null
    check (dimension in (
      'product_solution','customers','transaction','partners',
      'access','geography_regulatory','capital_asset')),
  weight numeric not null check (weight >= 0 and weight <= 1),
  rationale text,
  source text not null
    check (source in ('llm_proposed','human_adjusted')),
  created_at timestamptz not null default now()
);

-- LLM call logs: EVERY call. Non-negotiable.
create table llm_call_logs (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid references ventures(id) on delete set null,
  stage text not null,                 -- 'stage_1_extract', 'stage_1_critic', 'stage_2_weight'
  model_id text not null,              -- OpenRouter model string
  prompt_text text not null,
  input_documents jsonb,               -- references to docs used
  response_text text,
  response_parsed jsonb,
  tokens_in int,
  tokens_out int,
  cost_usd numeric,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);
```

Versioning note: `profile_versions` is **append-only**. The HITL refinement step writes a new row with `source = 'human_refined'`; we never overwrite the original LLM output. This is for debugging, evaluation, and eventually building a training set.

RLS policies should restrict all reads/writes to `created_by = auth.uid()` for now. We'll add team-sharing in Phase 4.

**InsForge auth-helper gotcha (per eng review D8):** `auth.uid()` works for application tables. Storage policies on `storage.objects` must use `auth.jwt() ->> 'sub'` instead — see `insforge/migrations/0002_storage_policies.sql`. Storage also requires per-operation policies (separate `FOR SELECT` / `INSERT` / `UPDATE` / `DELETE` blocks) rather than a single `FOR ALL`, and uses columns `bucket` (not `bucket_id`) + `key` (not `name`).

---

## 6. Directory structure

```
venturex/
├── CLAUDE.md                          ← you are here
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example                       ← document every required env var
├── prompts/
│   ├── stage_1_profile_extraction.md  ← see section 8
│   ├── stage_1_critic.md              ← see section 9
│   └── stage_2_dimension_weighting.md ← see section 11
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   ← landing / new venture
│   │   ├── ventures/
│   │   │   ├── new/page.tsx           ← upload + description form
│   │   │   ├── [id]/page.tsx          ← status / overview
│   │   │   ├── [id]/refine/page.tsx   ← HITL UI (Stage 1.5)
│   │   │   └── [id]/weights/page.tsx  ← weights UI (Stage 2)
│   │   └── api/                       ← route handlers if needed
│   ├── components/
│   │   ├── ui/                        ← shadcn primitives
│   │   ├── dimension-editor.tsx       ← reusable per-dimension edit panel
│   │   ├── weight-slider.tsx          ← 7-bar weight visual
│   │   └── source-quote.tsx           ← inline quote display
│   ├── lib/
│   │   ├── insforge/                  ← clients (server, browser)
│   │   ├── openrouter/                ← LLM call wrapper
│   │   ├── parsers/
│   │   │   ├── pdf.ts
│   │   │   ├── docx.ts
│   │   │   └── index.ts               ← dispatcher; rejects PPTX per D2
│   │   └── prompts.ts                 ← loads prompts/*.md into memory
│   ├── types/
│   │   └── venture-profile.ts         ← Zod schema for the profile
│   └── server/
│       ├── stage0-ingest.ts
│       ├── stage1-extract.ts
│       ├── stage1-critic.ts
│       └── stage2-weight.ts
├── insforge/
│   └── migrations/
└── test-cases/
    └── abb-rack-pdu/                  ← keystone fixture; see section 13
        ├── ABB_Case_Brief.docx
        ├── ABB_Market_Exploration.pdf
        ├── 20250922_Framing.pdf
        └── expected_profile.json      ← acceptance fixture
```

---

## 7. Stage 0 — Document Intake

**Goal:** Take a user's venture description + uploaded supporting documents and produce a clean markdown corpus that downstream stages can reason over.

**Inputs:** A short typed description from the user (plain text, required) and 0–N uploaded files (PDF, DOCX). PPTX deferred to Phase 4 per eng review D2 — Stage 0 rejects `.pptx` with a "convert to PDF first" message.

**Process:**
1. Create `ventures` row with `status = 'intake'`.
2. Upload each file to InsForge Storage; create `venture_documents` row.
3. For each document, dispatch to the appropriate parser:
   - PDF → `pdf-parse` → text. For PDFs with significant visual content (slides especially), consider falling back to a vision-model OCR pass; the ABB deck has text-light slides where the meaning lives in diagrams.
   - DOCX → `mammoth` → markdown with structure preserved.
   - PPTX → reject with HTTP 400 and copy "PPTX not supported in V1 — please export to PDF and re-upload" (D2; vision OCR fallback deferred to Phase 4).
4. Store parsed output in `venture_documents.parsed_markdown`.
5. Transition `ventures.status` to `'extracting'` and trigger Stage 1.

**Failure modes to handle:**
- Encrypted/password-protected PDFs → mark document with error, continue with the rest.
- DOCX with embedded images → fine to skip the image content for V1; flag in a log.
- (PPTX uploads are rejected upfront — see Stage 0 Inputs above.)

**No LLM calls in this stage.** Parsing is mechanical.

---

## 8. Stage 1 — Profile Extraction

**Goal:** Produce a structured 7-dimension VentureX profile from the parsed document corpus.

**The prompt lives at `prompts/stage_1_profile_extraction.md`.** Harry will paste this in separately. Treat that file as the source of truth; do not duplicate it in code. The prompt loader reads the file at runtime so the prompt can be iterated without redeploying.

**Model:** Claude Opus 4.7 via OpenRouter (`anthropic/claude-opus-4.7`). Configurable via env var `STAGE_1_MODEL` for A/B testing.

**Input assembly:** The prompt is composed as:
```
[prompt body from stage_1_profile_extraction.md]

# INPUT DOCUMENTS

## User-provided description
{ventures.user_provided_description}

## Document: {filename}
{venture_documents.parsed_markdown}

## Document: {filename}
{venture_documents.parsed_markdown}
...
```

If the combined input exceeds the model's effective context (>200k tokens), summarize each document with a cheaper model first. For Phase 1, this is unlikely; the ABB corpus is ~10k tokens. Log a warning if it happens; don't silently truncate.

**Output:** Valid JSON matching the schema in `src/types/venture-profile.ts`. Validate with Zod before storage. If validation fails, retry once with a corrective prompt, then escalate to error state and surface to the user — do not silently drop or guess.

**Profile shape (the Zod schema must match this exactly).** The 7 dimensions are nested under a top-level `dimensions` object. Top-level fields are `venture_codename`, `synthetic_description`, `intended_end_state`, `current_maturity`, `dimensions`, `strategic_risks_and_uncertainties[]`, `gaps_in_input[]`. (Per eng review D1, 2026-05-14.)

```
{
  venture_codename: "VentureX",
  synthetic_description: "...",
  intended_end_state: { scale, timeline_years, minimum_success_criteria },
  current_maturity: "pre_concept" | "concept" | "early_prototype" | "pilot" | "early_revenue" | "scaling",
  dimensions: {
    product_solution: {...},
    customers: {...},
    transaction: {...},
    partners: {...},
    access: {...},
    geography_regulatory: {...},
    capital_asset: {...}
  },
  strategic_risks_and_uncertainties: [{ risk, implies_search_for }, ...],
  gaps_in_input: [...]
}
```

**The 7 dimensions** (each lives at `dimensions.<name>`):

1. **product_solution** — `job_to_be_done`, `solution_mechanism`, `platform_or_pipe`, `core_features[]`, **`substitution_landscape[]`** (load-bearing), confidence, supporting_quotes[]
2. **customers** — `segment_type`, `buyer`, `user`, `target_sub_segments[]`, `buyer_sophistication`, confidence, supporting_quotes[]
3. **transaction** — `model`, `typical_deal_size_usd`, `margin_profile`, `revenue_recurrence`, confidence, supporting_quotes[]
4. **partners** — `distribution_channels[]`, `key_suppliers[]`, `regulators_certifications[]`, `system_integrators_resellers[]`, `complementary_product_partners[]`, confidence, supporting_quotes[]
5. **access** — `learn`, `reach`, `acquire`, `maintain`, `access_intensity`, confidence, supporting_quotes[]
6. **geography_regulatory** — `target_geographies[]`, `accessible_market_constraints[]`, `regulatory_regime`, `localization_requirements`, confidence, supporting_quotes[]
7. **capital_asset** — `capital_intensity`, `asset_type`, `manufacturing_footprint`, `defensibility_model`, `time_to_revenue_years`, confidence, supporting_quotes[]

**The `strategic_risks_and_uncertainties` field is the second load-bearing field.** Each risk must include an `implies_search_for` string that explicitly names what kinds of competitors/substitutes the risk implies. Phase 3 candidate generation uses this directly. If the prompt produces strategic risks without `implies_search_for`, the prompt is broken.

**Persistence:** Insert a `profile_versions` row with `source = 'llm_extracted'`, `version_number = 1`. Transition venture status to `'awaiting_refinement'` after the critic pass completes.

---

## 9. Stage 1 Critic — Multi-Model Sanity Check

**Goal:** A second frontier model reads the LLM-extracted profile against the source documents and flags weaknesses.

**The prompt lives at `prompts/stage_1_critic.md`.**

**Model:** GPT-5.5 via OpenRouter (`openai/gpt-5.5`). Configurable via `STAGE_1_CRITIC_MODEL`. **Always use a different model family than Stage 1.** If Stage 1 used Claude, critic uses GPT or Gemini, and vice versa. This is the entire point of the pass — same-family models share too many biases to critique each other usefully.

**Input:** The Stage 1 profile JSON plus the source documents.

**Output:** A JSON object with per-dimension flags: `weak`, `unsupported`, `over_confident`, `missing_context`, plus suggested edits. Stored as a new `profile_versions` row with `source = 'llm_critic'`, `version_number = 2`. **Not auto-applied** — the critic's output is shown alongside the original in the HITL UI as suggestions, and the human decides.

---

## 10. Stage 1.5 — HITL Refinement UI

**Goal:** Let the human review and refine the profile before anything downstream runs.

**Page:** `/ventures/[id]/refine`

**Layout:** A long-scrolling page with one panel per dimension, in fixed order (Product/Solution first; it's the most important and sets context for the rest). Each panel shows:

- The dimension's current values (editable inline)
- Confidence score (read-only badge)
- The 1–3 supporting source quotes, with document filename links
- Critic flags for this dimension, if any (collapsible "Reviewer notes")
- A "Save dimension" button that creates a new `profile_versions` row

Plus a top-level panel for `synthetic_description`, `intended_end_state`, `current_maturity`, `strategic_risks_and_uncertainties`, and `gaps_in_input`.

**Save semantics:** Every "Save" creates a new `profile_versions` row with `source = 'human_refined'` and an incremented `version_number`. The most recent human-refined version is the canonical input for Stage 2. **Never UPDATE an existing row.**

**Required interactions:**
- Inline editing of every text field
- Add/remove items in array fields (especially `substitution_landscape` and `strategic_risks_and_uncertainties` — these are the high-leverage ones, make them ergonomic to edit)
- Confirm-to-continue button at the bottom that transitions venture status to `'weighting'` and triggers Stage 2

**What the UI should make obvious:**
- Which fields have low confidence (visual indicator)
- Which fields the critic flagged
- Which dimensions still have gaps from `gaps_in_input`

Do not auto-save on every keystroke. Save explicitly per dimension.

---

## 11. Stage 2 — Dimension Weighting

**Goal:** Assign importance weights across the 7 dimensions for *this specific venture*.

**The prompt lives at `prompts/stage_2_dimension_weighting.md`.**

**Model:** Claude Opus 4.7 (`STAGE_2_MODEL`).

**Input:** The most recent human-refined `profile_versions` row.

**Output:** JSON with 7 weights summing to ~1.0, plus a rationale string per dimension. For ABB Rack PDU, expected output should weight Product/Solution, Capital, and Geography heavily, and Access lightly. Validate the sum is within [0.95, 1.05] and renormalize if needed.

**Persistence:** Seven `dimension_weights` rows with `source = 'llm_proposed'`.

**UI:** `/ventures/[id]/weights` — a 7-bar horizontal visualization, each bar with the weight value, a slider to adjust, and the rationale text below. User adjustment updates `dimension_weights` with `source = 'human_adjusted'` (insert, don't update). Confirm button transitions status to `'ready'`.

---

## 12. LLM call conventions

Every LLM call goes through `src/lib/openrouter/call.ts`. That wrapper:

1. Takes `{ model, stage, prompt, venture_id, input_documents }`.
2. Logs the call to `llm_call_logs` before execution (with placeholder response).
3. Executes the OpenRouter request with appropriate timeout (60s default, 180s for Stage 1).
4. Updates the log row with response, tokens, cost, latency.
5. Returns parsed JSON if successful; throws on failure.
6. On JSON parse failure: retry once with a corrective system message ("Your previous response was not valid JSON. Return only valid JSON matching the schema. Do not include any prose."). If still failing, throw.

**Cost discipline:** Stage 1 + Stage 1 Critic + Stage 2 for one venture should total under $2 in API spend. If a single call exceeds $1, surface a warning in the log. If a venture exceeds $5 total, halt and require explicit user retry.

**No streaming for V1.** Synchronous calls only. Streaming adds complexity (partial JSON parsing) that we don't need at this stage.

---

## 13. Acceptance criteria — ABB Rack PDU

The system passes Phase 1–2 acceptance when, run end-to-end on the materials in `/test-cases/abb-rack-pdu/`, the final human-refined profile + weights have:

**In `product_solution.substitution_landscape`** — must include all of: busbar/tap-off systems, power shelves, DC distribution, in-rack DC, and integrated server-mounted power. Missing any of these is a fail.

**In `strategic_risks_and_uncertainties`** — must include the 100–200kW migration risk and the AC-to-DC transition risk, each with a non-empty `implies_search_for` field.

**In `geography_regulatory.accessible_market_constraints`** — must include the China $500M / $75M accessibility gap.

**In `capital_asset`** — `capital_intensity` must be `high`, `asset_type` must be `hardware`.

**In `customers.segment_type`** — must be `B2B-Enterprise` (or `mixed` with B2B-E dominant).

**In Stage 2 weights** — product_solution, capital_asset, and geography_regulatory should each have weights ≥ 0.15. Access should have weight ≤ 0.05.

**Anonymization** — `synthetic_description` must not contain the word "ABB". "Industrial conglomerate," "electrical-equipment company," or similar is fine.

A copy of an acceptable expected profile lives at `test-cases/abb-rack-pdu/expected_profile.json`. Use it for snapshot-style assertions during development, but the criteria above are the source of truth — the prompts will iterate and produce different-but-acceptable wording.

---

## 14. Things to NOT do

- **Do not** hardcode prompts in TypeScript. Always load from `prompts/*.md`. Iteration on prompts is the highest-leverage activity in this phase; we want it to be a markdown edit, not a code change.
- **Do not** auto-apply critic suggestions to the profile. The human decides.
- **Do not** start building Phase 3 (candidate generation, search) until Phases 0–2 pass the ABB acceptance criteria. Premature integration with Exa/Serper will make profile iteration painful.
- **Do not** drop the supporting_quotes from any dimension. They are the audit trail and the HITL UI depends on them.
- **Do not** add a vector database, embedding service, or any RAG infrastructure. Not needed for these phases.
- **Do not** introduce LangChain, LlamaIndex, or other LLM frameworks. Direct OpenRouter calls only.
- **Do not** use Server Components for the HITL editing UI. It needs client-side interactivity.
- **Do not** invent dimensions, sub-fields, or categories that aren't specified here. If something seems missing, surface as an open question.

---

## 15. Build order

Suggested sequence. Each step should be commit-sized; gate progression on the criterion in parentheses.

1. **Scaffold** — Next.js app, InsForge project, env vars, basic auth. (App boots, user can log in.)
2. **DB schema** — migrations for the five tables above. (InsForge studio shows tables, RLS enabled.)
3. **Stage 0 parsers** — PDF/DOCX/PPTX parsers, unit tests against fixture files. (Given an ABB doc, returns clean markdown.)
4. **Upload flow** — `/ventures/new` page with description field and file upload. (User can submit a venture; documents appear in InsForge.)
5. **Zod schema** for `VentureProfile`. (Schema exists; round-trip a hand-written example.)
6. **OpenRouter wrapper** with logging. (Test call to Opus 4.7 returns and logs.)
7. **Stage 1 extraction** — load prompt, call Opus, validate, persist as `profile_versions` v1. (Running on ABB fixture produces a profile that hits acceptance criteria from section 13. **Do not move on until this passes.**)
8. **Stage 1 critic** — same shape, different model, persist as v2. (Critic produces flags on the v1 profile.)
9. **HITL UI** at `/ventures/[id]/refine`. (Can edit and save each dimension, creating new versions.)
10. **Stage 2 weighting** — prompt + call + persistence. (Weights generated and stored.)
11. **Weights UI** at `/ventures/[id]/weights`. (Can adjust and confirm.)
12. **End-to-end test** — run from upload to weighted profile on ABB fixture. (Full acceptance criteria pass.)

---

## 16. Open questions for the build owner

These are decisions I deliberately did not make because they need Harry's input. Surface them in the first standup; do not silently resolve them.

1. **Authentication scope.** ~~Phase 1 is single-user (only the uploader sees their ventures). Should we add team sharing now, or defer to Phase 4? Default: defer.~~ **Resolved 2026-05-14:** deferred per default. Email/password auth with 6-digit OTP verification implemented in M4 (D9). Team sharing deferred to Phase 4. Password reset deferred to Phase 4 (see PLAN.md "NOT in scope").
2. **PPTX visual content.** ~~ABB's market exploration deck has critical info inside diagrams (the power-density-over-time chart, the architecture diagrams). Should we add a vision-model OCR pass on slide screenshots in Stage 0, or rely on HITL to catch missing context?~~ **Resolved 2026-05-14:** PPTX dropped from V1 entirely per D2 — Stage 0 rejects `.pptx` with "convert to PDF first" message. Vision OCR fallback deferred to Phase 4. Consultants upload PDFs.
3. **Critic model choice.** GPT-5.5 is the current default for Stage 1 critic. If Pedram or the team has a preference for Gemini 3.1 Pro or Grok 4 here, easy to swap via env var. The constraint is "different family from Stage 1."
4. **Profile schema review with Pedram.** The 7 dimensions augment Pedram's Big 5 framework. He should eyeball the schema before we lock it, especially the `product_solution` sub-fields. Get this on his calendar in week 1.
5. **HITL save granularity.** Currently spec'd as save-per-dimension. Some users might prefer a single "save all" at the end. Worth a UX check with one of the DPZ team after the first working version.

---

*Last updated: May 14, 2026 (post-M4 — auth + upload flow working end-to-end). Authors: Harry (build lead), with Claude as planning collaborator. See PLAN.md for milestone status and decision log.*