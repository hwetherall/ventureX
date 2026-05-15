/**
 * M8 acceptance script — Stage 1 Critic dry-run.
 *
 * Mirrors what `src/server/stage1-critic.ts` does, but bypasses the
 * InsForge-coupled `callLLM` wrapper (no DB writes, no `llm_call_logs`
 * row) so it can be run without a live venture row. Direct OpenRouter
 * fetch + Zod validation against `Stage1CriticOutputSchema`.
 *
 * Inputs:
 *   - Profile JSON to critique (defaults to `test-cases/abb-rack-pdu/expected_profile.json`)
 *   - ABB source docs from `test-cases/abb-rack-pdu/` (PDFs + DOCX, parsed in-process)
 *   - Critic prompt from `prompts/stage_1_critic.md`
 *
 * Output:
 *   - Stdout summary: total flags, per-dimension counts, severity breakdown,
 *     top-level flags, overall_notes
 *   - Full JSON saved to `evals/results/critic-abb-<timestamp>.json`
 *
 * Env:
 *   - OPENROUTER_API_KEY (required)
 *   - STAGE_1_CRITIC_MODEL (optional, defaults to openai/gpt-5.5)
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/check-critic.ts [path-to-profile.json]
 *
 * Exit codes: 0 = critic produced valid output with ≥1 flag, 2 = critic
 * rubber-stamped (zero flags — suspicious), 1 = network/validation/setup failure.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseDocument } from "@/lib/parsers";
import {
  Stage1CriticOutputSchema,
  VentureProfileSchema,
  type Stage1CriticOutput,
  type VentureProfile,
} from "@/types/venture-profile";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_CRITIC_MODEL = "openai/gpt-5.5";
const TIMEOUT_MS = 180_000;
const DOCUMENTS_PLACEHOLDER =
  /\[The Stage 1 profile JSON and the source documents will be appended below\]\s*$/;

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface ParsedDoc {
  filename: string;
  markdown: string;
}

function mimeFor(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return PDF_MIME;
  if (ext === ".docx") return DOCX_MIME;
  return null;
}

async function loadAbbDocs(): Promise<ParsedDoc[]> {
  const dir = path.resolve("test-cases/abb-rack-pdu");
  const entries = await fs.readdir(dir);
  const docs: ParsedDoc[] = [];
  for (const filename of entries) {
    const mime = mimeFor(filename);
    if (!mime) continue;
    const buffer = await fs.readFile(path.join(dir, filename));
    try {
      const result = await parseDocument(buffer, mime);
      docs.push({ filename, markdown: result.markdown });
      console.error(
        `[parse] ${filename} → ${result.markdown.length.toLocaleString()} chars`,
      );
    } catch (err) {
      console.error(
        `[parse] FAILED ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return docs;
}

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

async function loadCriticPrompt(): Promise<string> {
  return fs.readFile(path.resolve("prompts/stage_1_critic.md"), "utf-8");
}

function assembleCriticPrompt(
  promptBody: string,
  profile: VentureProfile,
  docs: ParsedDoc[],
): string {
  const stripped = promptBody.replace(DOCUMENTS_PLACEHOLDER, "").trimEnd();
  const docBlocks = docs
    .map((d) => `## Document: ${d.filename}\n\n${d.markdown}`)
    .join("\n\n");
  return [
    stripped,
    "",
    "## Profile under review (JSON)",
    "",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    "## Source documents",
    "",
    docBlocks,
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
        "X-Title": "VentureX critic verification",
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
      throw new Error(
        `OpenRouter HTTP ${res.status}: ${body.slice(0, 500)}`,
      );
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

function summarize(output: Stage1CriticOutput): void {
  const dims = output.per_dimension;
  let total = 0;
  const sevCounts: Record<string, number> = {
    weak: 0,
    unsupported: 0,
    over_confident: 0,
    missing_context: 0,
  };

  console.log("");
  console.log("Per-dimension flag counts:");
  for (const [name, dim] of Object.entries(dims)) {
    const n = dim.flags.length;
    total += n;
    for (const f of dim.flags) sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;
    const suggested = dim.suggested_edits ? " [+suggested_edits]" : "";
    console.log(`  ${name.padEnd(22)} ${n} flag(s)${suggested}`);
    for (const f of dim.flags) {
      console.log(
        `    - [${f.severity}] ${f.field}: ${f.comment.slice(0, 140)}${f.comment.length > 140 ? "…" : ""}`,
      );
    }
  }

  console.log("");
  console.log(`Top-level flags: ${output.top_level_flags.length}`);
  for (const f of output.top_level_flags) {
    sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;
    console.log(
      `  - [${f.severity}] ${f.field}: ${f.comment.slice(0, 140)}${f.comment.length > 140 ? "…" : ""}`,
    );
  }

  if (output.overall_notes) {
    console.log("");
    console.log("Overall notes:");
    console.log(`  ${output.overall_notes}`);
  }

  console.log("");
  console.log("----------------------------------------");
  console.log(
    `Total flags: ${total + output.top_level_flags.length}  (per-dim: ${total}, top-level: ${output.top_level_flags.length})`,
  );
  console.log(
    `Severity:    weak=${sevCounts.weak}  unsupported=${sevCounts.unsupported}  over_confident=${sevCounts.over_confident}  missing_context=${sevCounts.missing_context}`,
  );
}

async function main(): Promise<void> {
  const profileArg =
    process.argv[2] ?? "test-cases/abb-rack-pdu/expected_profile.json";
  const profilePath = path.resolve(profileArg);
  const model = process.env.STAGE_1_CRITIC_MODEL ?? DEFAULT_CRITIC_MODEL;

  console.error(`[setup] critic model: ${model}`);
  console.error(`[setup] profile input: ${profilePath}`);

  const [profile, docs, promptBody] = await Promise.all([
    loadProfile(profilePath),
    loadAbbDocs(),
    loadCriticPrompt(),
  ]);

  if (docs.length === 0) {
    throw new Error(
      "No ABB source docs parsed. Confirm test-cases/abb-rack-pdu/ has the .pdf/.docx files.",
    );
  }

  const prompt = assembleCriticPrompt(promptBody, profile, docs);
  console.error(
    `[prompt] assembled, ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`,
  );

  console.error(`[call] POST OpenRouter → ${model} (timeout ${TIMEOUT_MS / 1000}s)`);
  const { content, tokensIn, tokensOut, costUsd, latencyMs } =
    await callOpenRouter(model, prompt);
  console.error(
    `[call] returned in ${latencyMs.toLocaleString()}ms  tokens=${tokensIn.toLocaleString()}/${tokensOut.toLocaleString()}  cost=$${costUsd.toFixed(4)}`,
  );

  const rawJson = extractJson(content);
  const validated = Stage1CriticOutputSchema.parse(rawJson);

  summarize(validated);

  const resultsDir = path.resolve("evals/results");
  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `critic-abb-${stamp}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        model,
        latency_ms: latencyMs,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        critic_output: validated,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.error(`[save] ${outPath}`);

  const totalFlags =
    validated.top_level_flags.length +
    Object.values(validated.per_dimension).reduce(
      (sum, d) => sum + d.flags.length,
      0,
    );

  if (totalFlags === 0) {
    console.error(
      "\nWARNING: critic produced zero flags. Per CLAUDE.md §9 calibration, that's a rubber-stamp — review the prompt.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
