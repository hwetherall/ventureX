/**
 * One-shot smoke test for the M15 cost+time predictor. Not part of the test
 * suite — this exists to eyeball the actual numbers across 1 / 5 / 53
 * candidate scenarios so the predictor output matches the design doc envelope.
 *
 * Run: `pnpm tsx scripts/smoke-predict.ts`
 */

import { HARDCODED_PARAMETERS } from "../src/lib/parameters/catalog";
import {
  formatCostRange,
  formatLatencyRange,
  predictStage5Cost,
} from "../src/lib/openrouter/predict";
import type { Parameter } from "../src/types/parameter";

const fakeDynamic: Parameter[] = Array.from({ length: 15 }).map((_, i) => ({
  id: `d_${i}`,
  name: `Dynamic ${i}`,
  tier: "dynamic" as const,
  innovera_dimension: "product_solution" as const,
  value_type: "prose" as const,
  cell_budget: "sentence" as const,
  citation_required: true,
  source_preference: ["news" as const, "official_company" as const],
  prompt_hint: "hint",
  source_field: "dimensions.product_solution.substitution_landscape",
}));

const schema: Parameter[] = [...HARDCODED_PARAMETERS, ...fakeDynamic];

for (const n of [1, 5, 53]) {
  const r = predictStage5Cost({ parameters: schema, candidateCount: n });
  console.log(`\n=== ${n} candidate(s) (${r.totalCells} cells) ===`);
  console.log(`Cost:    ${formatCostRange(r.costUsd)}`);
  console.log(`Latency: ${formatLatencyRange(r.latencyMs)}`);
  console.log(`LLM calls: ${r.totalLlmCalls}, Exa: up to ${r.totalExaSearches}`);
  console.log(
    `Cap-warn: approaching=${r.approachingBudgetCap}, exceeds=${r.exceedsBudgetCap}`,
  );
  for (const b of r.breakdown) {
    console.log(
      `  ${b.tier.padEnd(10)} ${b.cells.toString().padStart(3)} cells  ${formatCostRange(b.costUsd).padEnd(20)} ${b.llmCalls} LLM / ${b.exaSearches} Exa`,
    );
  }
}
