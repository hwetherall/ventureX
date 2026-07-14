import { runPerplexityCellResearchPostPass } from "@/server/stage5-cells-perplexity";

import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const [ventureId, sourceRunId] = positional;
  const targets = args
    .filter((arg) => arg.startsWith("--target="))
    .map((arg) => {
      const pair = arg.slice("--target=".length);
      const separator = pair.indexOf(":");
      if (separator <= 0 || separator === pair.length - 1) {
        throw new Error(
          `Invalid --target '${pair}'; expected CANDIDATE_UUID:PARAMETER_KEY.`,
        );
      }
      return {
        candidateId: pair.slice(0, separator),
        parameterKey: pair.slice(separator + 1),
      };
    });
  const asOf = args.find((arg) => arg.startsWith("--as-of="))?.slice(8);
  if (!ventureId || !sourceRunId || targets.length === 0) {
    throw new Error(
      "Usage: tsx --env-file=.env scripts/run-cell-research-perplexity-postpass.mts <venture_id> <completed_source_run_id> --target=CANDIDATE_UUID:PARAMETER_KEY [--target=...] [--as-of=ISO]",
    );
  }
  const client = await makeResearchOpsClient();
  console.log(
    `Starting explicit Perplexity post-pass from ${sourceRunId} for ${targets.length} allowlisted cells.`,
  );
  const result = await runPerplexityCellResearchPostPass({
    ventureId,
    sourceRunId,
    targets,
    insforge: client,
    asOf,
    productHint: "rack PDU and rack-level data-center power distribution",
    onProgress: (message) => console.log(message),
  });
  if (!result.ok) {
    console.error(
      `FAILED run=${result.runId ?? "none"} incremental_cost=$${result.incrementalCostUsd.toFixed(4)} total_cost=$${result.totalCostUsd.toFixed(4)}: ${result.error}`,
    );
    process.exit(2);
  }
  console.log(`run_id=${result.runId}`);
  console.log(`source_run_id=${result.sourceRunId}`);
  console.log(`incremental_cost_usd=${result.incrementalCostUsd.toFixed(4)}`);
  console.log(`total_cost_usd=${result.totalCostUsd.toFixed(4)}`);
  console.log(JSON.stringify(result.metrics, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
