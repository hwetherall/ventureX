import { runStage5CellResearchV2 } from "@/server/stage5-cells-v2";

import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

async function main() {
  const args = process.argv.slice(2);
  const ventureId = args.find((arg) => !arg.startsWith("--"));
  if (!ventureId) {
    throw new Error(
      "Usage: tsx --env-file=.env scripts/run-cell-research-v2.mts <venture_id> [--no-persist] [--as-of=ISO] [--concurrency=N] [--resume-run=UUID] [--retry-cell=CANDIDATE_UUID:PARAMETER_KEY]",
    );
  }
  const asOf = args.find((arg) => arg.startsWith("--as-of="))?.slice(8);
  const concurrencyRaw = args
    .find((arg) => arg.startsWith("--concurrency="))
    ?.slice(14);
  const concurrency = concurrencyRaw ? Number.parseInt(concurrencyRaw, 10) : 2;
  const resumeRunId = args
    .find((arg) => arg.startsWith("--resume-run="))
    ?.slice(13);
  const retryCellKeys = args
    .filter((arg) => arg.startsWith("--retry-cell="))
    .map((arg) => arg.slice(13));
  const client = await makeResearchOpsClient();
  console.log(
    `Starting isolated Cell Research V2 for ${ventureId}; persistence=${!args.includes("--no-persist")}; Perplexity disabled=${process.env.CELL_RESEARCH_PERPLEXITY_ENABLED !== "true"}`,
  );
  const result = await runStage5CellResearchV2({
    ventureId,
    insforge: client,
    asOf,
    productHint: "rack PDU and rack-level data-center power distribution",
    concurrency,
    persist: !args.includes("--no-persist"),
    resumeRunId,
    retryCellKeys,
  });
  if (!result.ok) {
    console.error(
      `FAILED run=${result.runId ?? "none"} cost=$${result.costUsd.toFixed(4)}: ${result.error}`,
    );
    process.exit(2);
  }
  console.log(`run_id=${result.runId}`);
  console.log(`cells=${result.outcomes.length}`);
  console.log(`cost_usd=${result.costUsd.toFixed(4)}`);
  console.log(`latency_seconds=${(result.latencyMs / 1000).toFixed(1)}`);
  console.log(JSON.stringify(result.metrics, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
