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

---

## Open

### 1. HITL save granularity feedback (claude.md Section 16 Q5)

**What:** After the first working version of M9 (HITL UI), run a 30-minute feedback session with someone from the DPZ team to validate save-per-dimension vs save-all-at-end UX.

**Why:** Current spec is save-per-dimension. This is defensible (explicit, version-rich, easy to debug). But consultants might prefer save-all-at-end (one click, less ceremony). A UX choice that's hard to predict without seeing someone use it.

**Pros of doing now:** Cheap signal early. Avoids building UX a user won't tolerate.
**Cons of doing now:** Premature — need a working version to test against. Don't book the meeting before M9 lands.

**Context:** This is a post-M9 task, before any wider rollout. The first version should be exactly per-spec (save-per-dimension) so the test is "does this fit your workflow" not "did we build the right thing."

**Depends on / blocked by:** M9 working version.

---

### 2. Second anonymized eval test case (D7 P1 follow-on)

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
