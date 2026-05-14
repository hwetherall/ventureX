# TODOS — VentureX

Living list of open follow-ups. Originally captured during the 2026-05-14 eng review; updated as work lands. Each item has context so it's pickup-able in 3 months.

---

## Done since last update

- ~~README content~~ — written in M1.
- ~~Storage bucket creation~~ — `venture-documents` bucket created in InsForge dashboard.
- ~~Storage RLS policies~~ — migration `0002_storage_policies.sql` applied (owner-only pattern, InsForge-specific syntax).
- ~~Auth implementation~~ — built in M4 alongside upload flow (email/password + 6-digit OTP verification per D9).
- ~~OpenRouter key rotation~~ — done after the original key was exposed in a transcript.

---

## Open

### 1. Drop ABB source documents into `test-cases/abb-rack-pdu/`

**What:** Place `ABB_Case_Brief.docx`, `ABB_Market_Exploration.pdf`, `20250922_Framing.pdf` (or whatever the actual filenames are — claude.md Section 13 references these specific names) into the directory. Currently the folder has only `expected_profile.json`.

**Why:** Two reasons:
1. M4 manual testing needs real files to upload through `/ventures/new`.
2. M11 eval framework will read these files from disk, run Stage 1 on them, and assert against Section 13 criteria.

**Pros of doing now:** Unblocks both M4 dogfooding and M11 eval.
**Cons of doing now:** None. Could be gitignored if the documents contain anything sensitive — the eval framework reads from disk and doesn't care about git status.

**Context:** Innovera consulting work materials. Confirm with the team whether they should be committed or kept local-only via `.gitignore` entry. If kept local, document in README so future devs know to fetch them from a known location.

**Depends on / blocked by:** Nothing.

---

### 2. Critic model choice (claude.md Section 16 Q3)

**What:** Confirm `STAGE_1_CRITIC_MODEL` default before M8. Current spec default is `openai/gpt-5.5`.

**Why:** The critic constraint is "different model family than Stage 1." Stage 1 is Claude Opus 4.7. Options for critic: GPT-5.5 (default), Gemini 3.1 Pro, Grok 4. Different families have different failure modes — Gemini sometimes catches Claude's anchoring in different places than GPT does.

**Pros of deciding now:** M8 wires up against the chosen model. Cost projections in M6's budget logic depend on the model's per-token price.
**Cons of deciding now:** Hard to know without running the critic on a couple of test cases. Could be a "ship default, swap later" decision.

**Context:** OpenRouter makes the swap trivial (env var change). The harder question is which model has the best critic-style failure-finding behavior on consulting-style profiles. The team has opinions; collect them.

**Depends on / blocked by:** Nothing. Should be locked before M8 implementation starts.

---

### 3. Schema cross-walk with Pedram (claude.md Section 16 Q4)

**What:** Get Pedram on calendar to eyeball the 7-dimension schema against his Big 5 framework. Originally meant to happen before M5 — M5 has now landed, so this is now a retrospective check that should happen before M7 prompt iteration starts changing the schema-affecting parts of the spec.

**Why:** Pedram's framework predates this work. The 7 dimensions augment his Big 5 — but he should validate the augmentations don't break what he already knows works. The product_solution sub-fields (especially `substitution_landscape`) are the most likely to need his input. The schema is already locked in code; if Pedram surfaces gaps, we have to plan an explicit migration plus prompt edits.

**Pros of doing now:** Catch any structural concerns before M7's prompt iteration cycle makes them more expensive to address.
**Cons of doing now:** Adds a calendar dependency to M7's start.

**Context:** Block 30 minutes on his calendar. Have the 7-dimension schema printed (or shared in Notion) with his Big 5 alongside for comparison. Specifically ask him about `substitution_landscape` and `strategic_risks_and_uncertainties.implies_search_for` — those are the load-bearing fields.

**Depends on / blocked by:** Pedram's availability. Should happen before M7 prompt iteration begins.

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

## Phase 4 backlog (deferred — captured here so we don't lose them)

These are NOT in scope for Phases 0-2 but documented so future-us has the context.

- **Multi-user team sharing.** Requires swapping storage RLS from owner-only (`uploaded_by =`) to a venture-JOIN pattern that lets team members access docs uploaded by other members. See `insforge/migrations/0002_storage_policies.sql` for the current policy; rewrite to match the "Team-shared Bucket" pattern in `~/.claude/skills/insforge/storage/postgres-rls.md` adapted to JOIN through `ventures.created_by` (or a new `team_id` column on `ventures`).
- **Password reset flow.** M4 covers signup + sign-in + OTP verification. Reset is straightforward via the InsForge SDK: `sendResetPasswordEmail` → `exchangeResetPasswordToken` → `resetPassword`. Same `/login` page can grow a 4th "reset" mode.
- **PPTX support with vision OCR.** Deferred per D2. Use Claude Sonnet for slide-image OCR if/when needed.
- **LLM streaming responses.** Spec'd as synchronous-only for V1 (claude.md Section 12). Streaming adds partial-JSON parsing complexity; revisit when latency UX matters.
