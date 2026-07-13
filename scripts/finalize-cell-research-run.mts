import { finalizeStage5CellResearchV2Run } from "@/server/stage5-cells-v2";

import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

const runId = process.argv[2];
const costUsd = Number.parseFloat(process.argv[3] ?? "");
if (!runId || !Number.isFinite(costUsd) || costUsd < 0) {
  throw new Error(
    "Usage: tsx --env-file=.env scripts/finalize-cell-research-run.mts <run_id> <total_cost_usd>",
  );
}

const client = await makeResearchOpsClient();
const metrics = await finalizeStage5CellResearchV2Run({
  insforge: client,
  runId,
  totalCostUsd: costUsd,
});
console.log(JSON.stringify({ run_id: runId, cost_usd: costUsd, metrics }, null, 2));
