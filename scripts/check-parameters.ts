/**
 * Parameter Builder dry-run.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/check-parameters.ts [profile.json]
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { mergeParameterSchema } from "@/lib/parameters/catalog";
import {
  assertUniqueParameterIds,
  validateParameterBuilderOutput,
} from "@/lib/parameters/validation";
import {
  Stage4ParameterBuilderOutputSchema,
  type Stage4ParameterBuilderOutput,
} from "@/types/parameter";
import {
  DIMENSION_KEYS,
  VentureProfileSchema,
  type Dimension,
  type VentureProfile,
} from "@/types/venture-profile";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-opus-4.7";
const TIMEOUT_MS = 120_000;
const DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON, canonical dimension weights, and prior parameter generations will be appended below\]\s*$/;

type CanonicalWeights = Record<
  Dimension,
  { weight: number; rationale: string | null }
>;

const ABB_WEIGHTS: CanonicalWeights = {
  product_solution: {
    weight: 0.25,
    rationale:
      "Substitution mechanisms and high-density rack architectures are load-bearing.",
  },
  customers: {
    weight: 0.08,
    rationale: "Customer segment matters but is not the central differentiator.",
  },
  transaction: {
    weight: 0.07,
    rationale: "Unit sales and margin risk matter but remain category-standard.",
  },
  partners: {
    weight: 0.1,
    rationale: "Channel and partner reach shape execution risk.",
  },
  access: {
    weight: 0.05,
    rationale: "Access is relevant mainly through IT-channel mismatch.",
  },
  geography_regulatory: {
    weight: 0.2,
    rationale: "China and India accessibility constraints are explicit risks.",
  },
  capital_asset: {
    weight: 0.25,
    rationale: "Hardware scale and manufacturing capacity are central to the moat.",
  },
};

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

function assemblePrompt(
  promptBody: string,
  profile: VentureProfile,
  weights: CanonicalWeights,
): string {
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
    "## Canonical dimension weights",
    "",
    "```json",
    JSON.stringify(weights, null, 2),
    "```",
    "",
    "## Prior parameter generations",
    "",
    "```json",
    "[]",
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
  choices: { message: { content: string } }[];
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
        "X-Title": "VentureX parameter verification",
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

function summarize(output: Stage4ParameterBuilderOutput): void {
  console.log("");
  console.log(`Dynamic parameters: ${output.dynamic_parameters.length}`);
  for (const p of output.dynamic_parameters) {
    console.log(
      `  ${p.id.padEnd(34)} ${p.innovera_dimension.padEnd(22)} ${p.source_field}`,
    );
  }
}

async function main(): Promise<void> {
  const profileArg =
    process.argv[2] ?? "test-cases/abb-rack-pdu/expected_profile.json";
  const profilePath = path.resolve(profileArg);
  const model = process.env.STAGE_4_PARAMETERS_MODEL ?? DEFAULT_MODEL;

  console.error(`[setup] stage 4 parameter model: ${model}`);
  console.error(`[setup] profile input: ${profilePath}`);

  const [profile, promptBody] = await Promise.all([
    loadProfile(profilePath),
    fs.readFile(path.resolve("prompts/stage_4_parameter_builder.md"), "utf-8"),
  ]);

  const prompt = assemblePrompt(promptBody, profile, ABB_WEIGHTS);
  console.error(
    `[prompt] assembled, ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`,
  );

  const { content, tokensIn, tokensOut, costUsd, latencyMs } =
    await callOpenRouter(model, prompt);
  console.error(
    `[call] returned in ${latencyMs.toLocaleString()}ms tokens=${tokensIn.toLocaleString()}/${tokensOut.toLocaleString()} cost=$${costUsd.toFixed(4)}`,
  );

  const rawJson = extractJson(content);
  const validated = Stage4ParameterBuilderOutputSchema.parse(rawJson);
  const dynamicParameters = validateParameterBuilderOutput(validated, profile);
  const fullSchema = mergeParameterSchema(dynamicParameters);
  assertUniqueParameterIds(fullSchema);

  summarize(validated);
  console.log("");
  console.log(`Full parameter schema: ${fullSchema.length}`);
  console.log(
    `Dimensions covered: ${DIMENSION_KEYS.filter((dim) =>
      dynamicParameters.some((p) => p.innovera_dimension === dim),
    ).join(", ")}`,
  );

  const resultsDir = path.resolve("evals/results");
  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `parameters-abb-${stamp}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        model,
        latency_ms: latencyMs,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        dynamic_parameters: dynamicParameters,
        full_parameter_schema: fullSchema,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.error(`[save] ${outPath}`);
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
