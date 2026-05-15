/**
 * M10 acceptance script — Stage 2 Dimension Weighting dry-run.
 *
 * Mirrors `src/server/stage2-weight.ts` but bypasses the InsForge-coupled
 * `callLLM` wrapper (no DB writes) so it can be run without a live venture.
 * Direct OpenRouter fetch + Zod validation against `Stage2WeightingOutputSchema`
 * + Section 13 weight-criteria assertions.
 *
 * Inputs:
 *   - Profile JSON to weight (defaults to `test-cases/abb-rack-pdu/expected_profile.json`)
 *   - Stage 2 prompt from `prompts/stage_2_dimension_weighting.md`
 *
 * Output:
 *   - Stdout: 7-bar weight summary, Section 13 criteria PASS/FAIL, synthesis
 *   - Full JSON saved to `evals/results/stage2-abb-<timestamp>.json`
 *
 * Env:
 *   - OPENROUTER_API_KEY (required)
 *   - STAGE_2_MODEL (optional, defaults to anthropic/claude-opus-4.7)
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/check-stage2.ts [path-to-profile.json]
 *
 * Exit codes:
 *   0 = valid Stage 2 output AND all Section 13 weight criteria pass
 *   2 = valid output but at least one Section 13 criterion fails
 *   1 = setup / network / schema-validation failure
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DIMENSION_KEYS,
  Stage2WeightingOutputSchema,
  VentureProfileSchema,
  type Dimension,
  type Stage2WeightingOutput,
  type VentureProfile,
} from "@/types/venture-profile";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_STAGE_2_MODEL = "anthropic/claude-opus-4.7";
const TIMEOUT_MS = 120_000;
const DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON will be appended below\]\s*$/;

// CLAUDE.md §13 — ABB Section 13 weight criteria.
const HIGH_WEIGHT_FLOOR = 0.15;
const ACCESS_WEIGHT_CEILING = 0.05;
const SUM_TOLERANCE_LOW = 0.97;
const SUM_TOLERANCE_HIGH = 1.03;
const HIGH_WEIGHT_DIMS: Dimension[] = [
  "product_solution",
  "capital_asset",
  "geography_regulatory",
];

async function loadProfile(profilePath: string): Promise<VentureProfile> {
  const raw = await fs.readFile(profilePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const candidate =
    typeof parsed === "object" &&
    parsed !== null &&
    "profile_json" in parsed
      ? (parsed as { profile_json: unknown }).profile_json
      : parsed;
  return VentureProfileSchema.parse(candidate);
}

async function loadStage2Prompt(): Promise<string> {
  return fs.readFile(
    path.resolve("prompts/stage_2_dimension_weighting.md"),
    "utf-8",
  );
}

function assemblePrompt(promptBody: string, profile: VentureProfile): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();
  return [
    stripped,
    "",
    "## VentureX profile (JSON)",
    "",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Response contained no parseable JSON object");
  }
}

interface OpenRouterResponse {
  choices: { message: { content: string }; finish_reason: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

async function callOpenRouter(
  model: string,
  prompt: string,
): Promise<{
  content: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing from environment");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "VentureX stage 2 verification",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as OpenRouterResponse;
    const content = data.choices[0]?.message.content;
    if (!content) throw new Error("OpenRouter returned no content");
    return {
      content,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      costUsd: data.usage?.cost ?? 0,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface CriterionResult {
  pass: boolean;
  detail: string;
}

function checkSectionThirteen(
  output: Stage2WeightingOutput,
): { criteria: { id: string; result: CriterionResult }[]; passing: number } {
  const w = output.weights;
  const sum = DIMENSION_KEYS.reduce((acc, k) => acc + w[k].weight, 0);

  const criteria: { id: string; result: CriterionResult }[] = [
    {
      id: "sum_within_tolerance",
      result: {
        pass: sum >= SUM_TOLERANCE_LOW && sum <= SUM_TOLERANCE_HIGH,
        detail: `Sum = ${sum.toFixed(4)} (target [${SUM_TOLERANCE_LOW}, ${SUM_TOLERANCE_HIGH}])`,
      },
    },
    ...HIGH_WEIGHT_DIMS.map((dim) => ({
      id: `${dim}_high`,
      result: {
        pass: w[dim].weight >= HIGH_WEIGHT_FLOOR,
        detail: `${dim} weight = ${w[dim].weight.toFixed(3)} (need ≥${HIGH_WEIGHT_FLOOR})`,
      },
    })),
    {
      id: "access_low",
      result: {
        pass: w.access.weight <= ACCESS_WEIGHT_CEILING,
        detail: `access weight = ${w.access.weight.toFixed(3)} (need ≤${ACCESS_WEIGHT_CEILING})`,
      },
    },
  ];

  const passing = criteria.filter((c) => c.result.pass).length;
  return { criteria, passing };
}

function renderWeightBar(weight: number, width = 30): string {
  const filled = Math.round(weight * width * 4); // scale: 1.0 → 4× full width
  const cap = Math.min(filled, width);
  return "█".repeat(cap) + "·".repeat(Math.max(0, width - cap));
}

function summarize(output: Stage2WeightingOutput): void {
  console.log("");
  console.log("Per-dimension weights:");
  for (const dim of DIMENSION_KEYS) {
    const w = output.weights[dim];
    const bar = renderWeightBar(w.weight);
    console.log(`  ${dim.padEnd(22)} ${w.weight.toFixed(3)}  ${bar}`);
    console.log(
      `    ${w.rationale.slice(0, 180)}${w.rationale.length > 180 ? "…" : ""}`,
    );
  }

  if (output.synthesis_notes) {
    console.log("");
    console.log("Synthesis:");
    console.log(`  ${output.synthesis_notes}`);
  }
}

async function main(): Promise<void> {
  const profileArg =
    process.argv[2] ?? "test-cases/abb-rack-pdu/expected_profile.json";
  const profilePath = path.resolve(profileArg);
  const model = process.env.STAGE_2_MODEL ?? DEFAULT_STAGE_2_MODEL;

  console.error(`[setup] stage 2 model: ${model}`);
  console.error(`[setup] profile input: ${profilePath}`);

  const [profile, promptBody] = await Promise.all([
    loadProfile(profilePath),
    loadStage2Prompt(),
  ]);

  const prompt = assemblePrompt(promptBody, profile);
  console.error(
    `[prompt] assembled, ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`,
  );

  console.error(
    `[call] POST OpenRouter → ${model} (timeout ${TIMEOUT_MS / 1000}s)`,
  );
  const { content, tokensIn, tokensOut, costUsd, latencyMs } =
    await callOpenRouter(model, prompt);
  console.error(
    `[call] returned in ${latencyMs.toLocaleString()}ms  tokens=${tokensIn.toLocaleString()}/${tokensOut.toLocaleString()}  cost=$${costUsd.toFixed(4)}`,
  );

  const rawJson = extractJson(content);
  const validated = Stage2WeightingOutputSchema.parse(rawJson);

  summarize(validated);

  const { criteria, passing } = checkSectionThirteen(validated);
  console.log("");
  console.log("Section 13 weight criteria:");
  for (const c of criteria) {
    const tag = c.result.pass ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${c.id}  →  ${c.result.detail}`);
  }
  console.log("");
  console.log(`${passing}/${criteria.length} criteria passed`);

  const resultsDir = path.resolve("evals/results");
  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `stage2-abb-${stamp}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        model,
        latency_ms: latencyMs,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        section_13: criteria,
        stage_2_output: validated,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.error(`[save] ${outPath}`);

  if (passing < criteria.length) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
