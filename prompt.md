# Continue cell research for VentureX project

## Goal
Research cells for all 42 candidate companies under venture `4f61ad40-2d5f-47ee-a45c-0b7149a5ee41`. 10 are already done; ~32 remain. Get all 42 into `cells` table without re-researching the ones that already have cells.

## Identifiers
- **Venture ID:** `4f61ad40-2d5f-47ee-a45c-0b7149a5ee41`
- **InsForge project ID:** `0a5c6935-02d9-4340-b768-bc9c554f1826` (org `943550dc-5db9-44b9-926f-a56ee81288d5`, link config at `.insforge/project.json`)
- **InsForge MCP** is now installed and should appear under `mcp__*insforge*` tools. Verify on startup; fall back to the `insforge` CLI (also on PATH) if not.

## Where you left off
The venture is currently in `status='error'` with error_message:
> Cell research requires status='parameters_ready' on entry; venture is in status='cells_ready'. Generate parameters before researching cells.

This is the **post-failure** state from the multi-candidate orchestrator's catch block (`src/server/stage5-cells.ts:312-316`). The actual root cause was: the previous batch (~31 candidates) **succeeded**, so status moved `parameters_ready → cells_researching → cells_ready`. Then the user clicked "Research" again, which tripped the precondition check, and the catch wrote the precondition message as the error_message and set status to `error`. The error_message is misleading — parameters ARE done; this is a status state-machine issue, not a missing-parameters issue.

## How the state machine works (read carefully)
File: `src/server/stage5-cells.ts`

- **`PRECONDITION_STATUS = 'parameters_ready'`** (line 41) — required to start a cell-research run
- **`IN_PROGRESS_STATUS = 'cells_researching'`** (line 42)
- **`SUCCESS_STATUS = 'cells_ready'`** (line 43) — set on completion via `markCellsReady`
- The transition `parameters_ready → cells_researching` is **atomic** via conditional UPDATE (line 469-474). Two concurrent runs can't both proceed.
- After a successful batch the orchestrator does NOT auto-flip back; status sits at `cells_ready` until something resets it.
- **To run another batch, flip status manually back to `parameters_ready`:**
  ```sql
  UPDATE ventures SET status='parameters_ready', error_message=NULL
  WHERE id='4f61ad40-2d5f-47ee-a45c-0b7149a5ee41';
  ```
- Existing `cells` rows are preserved — `insertCells` (line 1298) only deletes by `candidate_id` for the candidate currently being researched. So flipping status does NOT lose research.

## Per-venture budget cap (critical for batch sizing)
File: `src/server/stage5-cells.ts:63` and `src/lib/openrouter/predict.ts:108`

- `DEFAULT_PER_VENTURE_BUDGET_CAP_USD = 100`
- The orchestrator calls `predictStage5Cost` BEFORE any LLM call (line 256-265) and hard-halts if `prediction.exceedsBudgetCap === true`, which is defined as `costUsd.max >= cap` (predict.ts:253).
- For ~31 candidates with this venture's parameter schema, the upper-bound estimate likely lands above $100, which is what caused the original failure (~418ms first call = predictor reject + status-to-error).
- **Size each batch so the predictor's upper bound stays under $100.** Empirically the actual cost lands well below the upper bound (M12/M13 calibration: ~$0.40-0.55/candidate on framework tier), but the cap is checked against `costUsd.max` not actual. Batch sizes around **10-15 candidates** are likely safe; verify by calling `predictStage5Cost` yourself before submitting.

## What NOT to do
1. **Do NOT click the "Reset cell research" button** in the UI. `resetCellResearch` (`src/app/ventures/[id]/dossier/actions.ts:25-112`) DELETES every cell and exa_call_log for the venture before flipping status. That would wipe the 10 dossiers already done.
2. **Do NOT re-submit candidate IDs that already have cells.** `insertCells` does delete-then-insert per candidate by `(candidate_id, parameter_key)` (stage5-cells.ts:1310-1313), so re-submission redoes the work AND eats budget. Filter the candidate list to only those with `cell_count = 0` before submitting.
3. **Do NOT raise `DEFAULT_PER_VENTURE_BUDGET_CAP_USD`** without explicit user OK. The cap exists to scream when an order-of-magnitude regression happens.

## Suggested first moves
1. Confirm InsForge MCP is wired up. List available `mcp__*insforge*` tools.
2. Query current state and report back:
   - `SELECT id, status, error_message FROM ventures WHERE id='4f61ad40-2d5f-47ee-a45c-0b7149a5ee41'`
   - Per-candidate cell counts:
     ```sql
     SELECT cc.id, cc.name, COUNT(c.id) AS cell_count
     FROM candidate_companies cc
     LEFT JOIN cells c ON c.candidate_id = cc.id
     WHERE cc.venture_id='4f61ad40-2d5f-47ee-a45c-0b7149a5ee41'
     GROUP BY cc.id, cc.name
     ORDER BY cell_count DESC, cc.name
     ```
   - Verify exactly which candidates need research (cell_count = 0).
3. Use `TaskCreate` to track the multi-batch loop — each batch is one task, plus a "reset status" task before each batch.
4. Read `src/server/stage5-cells.ts`, `src/lib/openrouter/predict.ts`, and `src/app/ventures/[id]/dossier/actions.ts` end-to-end before kicking off any batches — there are subtleties (deletion semantics, status atomicity) that the summary above abbreviates.
5. Compute the predictor's upper-bound for a candidate batch of size N (e.g., 10, 15, 20) and pick the largest N where `costUsd.max < $100`. Confirm the batch size + estimated cost with the user before triggering.
6. For each batch: flip status to `parameters_ready` → trigger `runStage5CellResearchMulti` with the unresearched candidate IDs → wait for `cells_ready` → repeat.

## Trigger path (server action vs direct invocation)
The UI button calls `triggerMultiCandidateCellResearch` (`src/app/ventures/[id]/dossier/actions.ts:178-221`), which calls `runStage5CellResearchMulti` (`src/server/stage5-cells.ts:239`). You can either:
- Drive the UI (preferred — same path the user uses; revalidates Next.js cache properly).
- Or write a one-off Node script that imports `runStage5CellResearchMulti` and calls it directly with the filtered candidate ID list. If you go this route, the script must construct an authed InsForge server client the same way the server action does (`createAuthedServerClient` from `@/lib/insforge/server`).

## Acceptance gate
Done when:
- All 42 candidates under venture `4f61ad40-2d5f-47ee-a45c-0b7149a5ee41` have a non-zero cell count.
- `ventures.status = 'cells_ready'`, `ventures.error_message IS NULL`.
- No duplicate work: candidates with prior cells were NOT re-researched (verify by checking `cells.created_at` timestamps on the original 10).

## Reference: project context
The project follows `C:\dev\VentureX\CLAUDE.md` (Phases 0-2) and `PHASE3.md` (candidate generation + cell research). M15 covers cell research / the X×Y matrix fill. Today's date: 2026-05-20.
