import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

const selector = process.argv[2];
if (!selector) {
  throw new Error(
    "Usage: tsx --env-file=.env scripts/status-cell-research-run.mts <run_id|--latest-for=venture_id>",
  );
}

const client = await makeResearchOpsClient();
const runQuery = client.database
  .from("cell_research_runs")
  .select(
    "id,status,actual_cost_usd,started_at,completed_at,error,candidate_ids,parameter_keys",
  );
const latestVentureId = selector.startsWith("--latest-for=")
  ? selector.slice("--latest-for=".length)
  : undefined;
const { data: runRows, error: runError } = latestVentureId
  ? await runQuery
      .eq("venture_id", latestVentureId)
      .order("created_at", { ascending: false })
      .limit(1)
  : await runQuery.eq("id", selector).limit(1);
if (runError) throw new Error(`Failed to load run: ${runError.message}`);
const run = runRows?.[0];
if (!run) throw new Error(`Research run not found: ${selector}`);

const { data: results, error: resultError } = await client.database
  .from("cell_research_results")
  .select("cost_usd,final_confidence")
  .eq("run_id", run.id);
if (resultError) {
  throw new Error(`Failed to load run results: ${resultError.message}`);
}

const rows = (results ?? []) as Array<{
  cost_usd: number | null;
  final_confidence: string | null;
}>;
const persistedCostUsd = rows.reduce(
  (total, row) => total + Number(row.cost_usd ?? 0),
  0,
);
const confidences = rows.reduce<Record<string, number>>((counts, row) => {
  const confidence = row.final_confidence ?? "pending";
  counts[confidence] = (counts[confidence] ?? 0) + 1;
  return counts;
}, {});
const candidateCount = Array.isArray(run.candidate_ids)
  ? run.candidate_ids.length
  : 0;
const parameterCount = Array.isArray(run.parameter_keys)
  ? run.parameter_keys.length
  : 0;

console.log(
  JSON.stringify(
    {
      runId: run.id,
      status: run.status,
      completedCells: rows.length,
      expectedCells: candidateCount * parameterCount,
      persistedCostUsd,
      confidences,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      finalCostUsd: run.actual_cost_usd,
      error: run.error,
    },
    null,
    2,
  ),
);
