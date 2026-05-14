# VentureX

Internal competitive-landscape tool for Innovera. Replaces Competely.ai for upstream
profile extraction and HITL refinement. Phases 0-2: document intake → LLM profile
extraction → multi-model critic → human refinement → dimension weighting.

## Documents

- **`claude.md`** — Full spec and build context (the source of truth for Phases 0-2).
- **`PLAN.md`** — Execution plan with 11 milestones, dependencies, parallelization, and eng-review decisions (D1-D9).
- **`TODOS.md`** — Captured follow-ups and open questions.
- **`prompts/`** — LLM prompts (loaded at runtime, not bundled into code).
- **`test-cases/abb-rack-pdu/`** — Keystone test case with `expected_profile.json` for eval framework.

## Run locally

```bash
pnpm install
cp .env.example .env.local
# Fill in InsForge + OpenRouter keys, then:
pnpm dev
```

App boots at <http://localhost:3000>.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Hosting | Vercel |
| Database & auth | InsForge (Postgres + RLS + Storage) |
| LLM routing | OpenRouter (Claude Opus 4.7, GPT-5.5 critic) |
| Styling | Tailwind 4 + shadcn/ui |
| Validation | Zod |

## Project status

Greenfield, M1 scaffold landed (2026-05-14). See `PLAN.md` for next milestones.
