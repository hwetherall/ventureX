/**
 * Eval CLI. Usage:
 *
 *   pnpm eval [case-id]               # runs the named case (default: abb-rack-pdu)
 *   pnpm eval --list                  # lists available cases
 *
 * Exit codes:
 *   0 = all Section 13 criteria passed
 *   2 = at least one criterion failed (eval ran cleanly, output didn't pass)
 *   1 = setup / network / validation failure (eval couldn't complete)
 *
 * Runs Stage 1 + Stage 2 live via OpenRouter against the named case. Saves
 * raw stage outputs to `evals/results/`. Section 13 criteria from
 * `evals/criteria.ts` are applied to each stage's output.
 *
 * Cost budget: ~$0.50 per ABB run as of 2026-05-15.
 */

import { abbRackPduCase } from "./cases/abb-rack-pdu/case";
import { runCase } from "./runner";
import type { EvalCase, EvalResult, StageResultSummary } from "./types";

const CASES: EvalCase[] = [abbRackPduCase];
const DEFAULT_CASE_ID = "abb-rack-pdu";

function findCase(id: string): EvalCase | undefined {
  return CASES.find((c) => c.id === id);
}

function listCases(): void {
  console.log("Available eval cases:");
  for (const c of CASES) {
    console.log(`  ${c.id.padEnd(20)} ${c.name}`);
  }
}

function renderStage(label: string, stage: StageResultSummary): void {
  console.log("");
  console.log(`${label}  (${stage.passing}/${stage.total} criteria)`);
  console.log(
    `  ${stage.tokensIn.toLocaleString()}/${stage.tokensOut.toLocaleString()} tokens, $${stage.costUsd.toFixed(4)}, ${stage.latencyMs.toLocaleString()}ms, ${stage.attempts} attempt(s)`,
  );
  for (const c of stage.criteriaResults) {
    const tag = c.result.pass ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${c.id.padEnd(32)} ${c.result.detail}`);
  }
}

function renderSummary(result: EvalResult): void {
  console.log("");
  console.log("========================================");
  console.log(`${result.caseName} (${result.caseId})`);
  console.log("========================================");
  renderStage("Stage 1 — VentureProfile", result.stage1);
  renderStage("Stage 2 — Dimension weights", result.stage2);

  const totalCriteria = result.stage1.total + result.stage2.total;
  const totalPassing = result.stage1.passing + result.stage2.passing;
  console.log("");
  console.log("----------------------------------------");
  console.log(
    `${totalPassing}/${totalCriteria} total criteria passed  |  $${result.totalCostUsd.toFixed(4)}  |  ${(result.totalLatencyMs / 1000).toFixed(1)}s`,
  );
  console.log(result.allPassing ? "PASS" : "FAIL");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.includes("-l")) {
    listCases();
    return;
  }

  const caseId = args.find((a) => !a.startsWith("-")) ?? DEFAULT_CASE_ID;
  const evalCase = findCase(caseId);
  if (!evalCase) {
    console.error(`Unknown case id: ${caseId}`);
    listCases();
    process.exit(1);
  }

  console.error(`[eval] running ${evalCase.name} (${evalCase.id})`);
  const result = await runCase(evalCase, {
    onProgress: (line) => console.error(line),
  });

  renderSummary(result);
  process.exit(result.allPassing ? 0 : 2);
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
