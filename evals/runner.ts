/**
 * Eval runner. Drives Stage 1 + Stage 2 against a single eval case using the
 * DB-less OpenRouter caller, then applies the Section 13 criteria. Returns a
 * structured `EvalResult`; the CLI renders it.
 *
 * The runner is split from the CLI so future caller surfaces (CI job, web
 * dashboard, follow-on benchmark scripts) can invoke it programmatically
 * without piping through stdout.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  Stage2WeightingOutputSchema,
  VentureProfileSchema,
  type Stage2WeightingOutput,
  type VentureProfile,
} from "@/types/venture-profile";
import { STAGE_1_CRITERIA, STAGE_2_CRITERIA } from "./criteria";
import { callOpenRouterDirect } from "./lib/openrouter";
import { loadCaseDocuments } from "./lib/parse-docs";
import {
  assembleStage1Prompt,
  assembleStage2Prompt,
  loadStage1Prompt,
  loadStage2Prompt,
} from "./lib/prompts";
import type { EvalCase, EvalResult, StageResultSummary } from "./types";

const DEFAULT_STAGE_1_MODEL = "anthropic/claude-opus-4.7";
const DEFAULT_STAGE_2_MODEL = "anthropic/claude-opus-4.7";

// Stage 1's ABB-scale corpus runs in 30-120s typically; keep parity with
// the production wrapper's timeout. Stage 2 is much smaller input.
const STAGE_1_TIMEOUT_MS = 180_000;
const STAGE_2_TIMEOUT_MS = 60_000;

export interface RunCaseOptions {
  /** Optional output directory for raw stage artifacts. Defaults to evals/results. */
  resultsDir?: string;
  /** If provided, used in place of STAGE_1_MODEL env var / hardcoded default. */
  stage1Model?: string;
  stage2Model?: string;
  /** Optional progress hook for the CLI; receives single-line status strings. */
  onProgress?: (line: string) => void;
}

export async function runCase(
  evalCase: EvalCase,
  opts: RunCaseOptions = {},
): Promise<EvalResult> {
  const log = opts.onProgress ?? (() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = opts.resultsDir ?? path.resolve("evals/results");
  await fs.mkdir(resultsDir, { recursive: true });

  const stage1Model =
    opts.stage1Model ?? process.env.STAGE_1_MODEL ?? DEFAULT_STAGE_1_MODEL;
  const stage2Model =
    opts.stage2Model ?? process.env.STAGE_2_MODEL ?? DEFAULT_STAGE_2_MODEL;

  // ── Stage 1 ───────────────────────────────────────────────────────────
  log(`[${evalCase.id}] loading documents from ${evalCase.documents_dir}`);
  const { docs, warnings } = await loadCaseDocuments(evalCase.documents_dir);
  if (warnings.length > 0) {
    for (const w of warnings) log(`[${evalCase.id}] doc warning: ${w}`);
  }
  if (docs.length === 0) {
    throw new Error(
      `No parseable documents in ${evalCase.documents_dir}. Stage 1 cannot run.`,
    );
  }

  const stage1PromptBody = await loadStage1Prompt();
  const stage1Prompt = assembleStage1Prompt(
    stage1PromptBody,
    evalCase.user_provided_description,
    docs,
  );
  log(
    `[${evalCase.id}] stage 1 prompt assembled (~${Math.ceil(stage1Prompt.length / 4).toLocaleString()} tokens), calling ${stage1Model}`,
  );

  const stage1Call = await callOpenRouterDirect<VentureProfile>({
    model: stage1Model,
    prompt: stage1Prompt,
    schema: VentureProfileSchema,
    timeoutMs: STAGE_1_TIMEOUT_MS,
    title: `VentureX eval ${evalCase.id} stage 1`,
  });
  log(
    `[${evalCase.id}] stage 1 returned in ${stage1Call.latencyMs.toLocaleString()}ms, $${stage1Call.costUsd.toFixed(4)}, ${stage1Call.attempts} attempt(s)`,
  );

  await fs.writeFile(
    path.join(resultsDir, `${evalCase.id}-stage1-${stamp}.json`),
    JSON.stringify(
      {
        case_id: evalCase.id,
        model: stage1Model,
        latency_ms: stage1Call.latencyMs,
        tokens_in: stage1Call.tokensIn,
        tokens_out: stage1Call.tokensOut,
        cost_usd: stage1Call.costUsd,
        attempts: stage1Call.attempts,
        profile: stage1Call.data,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const stage1Results = STAGE_1_CRITERIA.map((c) => ({
    id: c.id,
    description: c.description,
    result: c.check(stage1Call.data),
  }));
  const stage1Summary: StageResultSummary = {
    criteriaResults: stage1Results,
    passing: stage1Results.filter((r) => r.result.pass).length,
    total: stage1Results.length,
    tokensIn: stage1Call.tokensIn,
    tokensOut: stage1Call.tokensOut,
    costUsd: stage1Call.costUsd,
    latencyMs: stage1Call.latencyMs,
    attempts: stage1Call.attempts,
  };

  // ── Stage 2 ───────────────────────────────────────────────────────────
  const stage2PromptBody = await loadStage2Prompt();
  const stage2Prompt = assembleStage2Prompt(stage2PromptBody, stage1Call.data);
  log(
    `[${evalCase.id}] stage 2 prompt assembled (~${Math.ceil(stage2Prompt.length / 4).toLocaleString()} tokens), calling ${stage2Model}`,
  );

  const stage2Call = await callOpenRouterDirect<Stage2WeightingOutput>({
    model: stage2Model,
    prompt: stage2Prompt,
    schema: Stage2WeightingOutputSchema,
    timeoutMs: STAGE_2_TIMEOUT_MS,
    title: `VentureX eval ${evalCase.id} stage 2`,
  });
  log(
    `[${evalCase.id}] stage 2 returned in ${stage2Call.latencyMs.toLocaleString()}ms, $${stage2Call.costUsd.toFixed(4)}, ${stage2Call.attempts} attempt(s)`,
  );

  await fs.writeFile(
    path.join(resultsDir, `${evalCase.id}-stage2-${stamp}.json`),
    JSON.stringify(
      {
        case_id: evalCase.id,
        model: stage2Model,
        latency_ms: stage2Call.latencyMs,
        tokens_in: stage2Call.tokensIn,
        tokens_out: stage2Call.tokensOut,
        cost_usd: stage2Call.costUsd,
        attempts: stage2Call.attempts,
        weights: stage2Call.data,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const stage2Results = STAGE_2_CRITERIA.map((c) => ({
    id: c.id,
    description: c.description,
    result: c.check(stage2Call.data),
  }));
  const stage2Summary: StageResultSummary = {
    criteriaResults: stage2Results,
    passing: stage2Results.filter((r) => r.result.pass).length,
    total: stage2Results.length,
    tokensIn: stage2Call.tokensIn,
    tokensOut: stage2Call.tokensOut,
    costUsd: stage2Call.costUsd,
    latencyMs: stage2Call.latencyMs,
    attempts: stage2Call.attempts,
  };

  const totalCostUsd = stage1Call.costUsd + stage2Call.costUsd;
  const totalLatencyMs = stage1Call.latencyMs + stage2Call.latencyMs;
  const allPassing =
    stage1Summary.passing === stage1Summary.total &&
    stage2Summary.passing === stage2Summary.total;

  const result: EvalResult = {
    caseId: evalCase.id,
    caseName: evalCase.name,
    stage1: stage1Summary,
    stage2: stage2Summary,
    totalCostUsd,
    totalLatencyMs,
    allPassing,
  };

  await fs.writeFile(
    path.join(resultsDir, `${evalCase.id}-summary-${stamp}.json`),
    JSON.stringify(result, null, 2),
    "utf-8",
  );

  return result;
}
