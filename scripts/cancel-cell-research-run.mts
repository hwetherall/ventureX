import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

const runId = process.argv[2];
if (!runId) {
  throw new Error(
    "Usage: tsx --env-file=.env scripts/cancel-cell-research-run.mts <run_id>",
  );
}

const client = await makeResearchOpsClient();
const { data: results, error: resultError } = await client.database
  .from("cell_research_results")
  .select("cost_usd")
  .eq("run_id", runId);
if (resultError) throw new Error(`Failed to total partial run: ${resultError.message}`);
const costUsd = ((results ?? []) as Array<{ cost_usd: number | null }>).reduce(
  (total, row) => total + Number(row.cost_usd ?? 0),
  0,
);
const { error } = await client.database
  .from("cell_research_runs")
  .update({
    status: "cancelled",
    actual_cost_usd: costUsd,
    error:
      "Cancelled after transient OpenRouter transport failures during live validation; superseded by retry-hardened run.",
    completed_at: new Date().toISOString(),
  })
  .eq("id", runId);
if (error) throw new Error(`Failed to cancel run: ${error.message}`);
console.log(`cancelled run=${runId} persisted_cost_usd=${costUsd.toFixed(4)}`);
