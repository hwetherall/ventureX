/**
 * Prompt assemblers for the eval framework. Mirrors the assembly logic in
 * `src/server/stage1-extract.ts` and `src/server/stage2-weight.ts` so the
 * eval framework sees the same prompts the production orchestrators send.
 *
 * NB: this duplicates a small amount of logic from the orchestrators. The
 * alternative (export the assemble* functions from the orchestrator files)
 * would couple the eval framework to the server-side module graph. Keeping
 * them separate is the cheaper choice for V1; if the assembly logic gets
 * complex enough to drift, refactor into `src/lib/prompts/` shared.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { VentureProfile } from "@/types/venture-profile";
import type { ParsedEvalDoc } from "./parse-docs";

const STAGE_1_DOCUMENTS_PLACEHOLDER =
  /\[Documents will be appended here\]\s*$/;

const STAGE_2_DOCUMENTS_PLACEHOLDER =
  /\[The VentureX profile JSON will be appended below\]\s*$/;

export async function loadStage1Prompt(): Promise<string> {
  return fs.readFile(
    path.resolve("prompts/stage_1_profile_extraction.md"),
    "utf-8",
  );
}

export async function loadStage2Prompt(): Promise<string> {
  return fs.readFile(
    path.resolve("prompts/stage_2_dimension_weighting.md"),
    "utf-8",
  );
}

export function assembleStage1Prompt(
  promptBody: string,
  description: string,
  docs: ParsedEvalDoc[],
): string {
  const stripped = promptBody
    .replace(STAGE_1_DOCUMENTS_PLACEHOLDER, "")
    .trimEnd();
  const docBlocks = docs
    .map((d) => `## Document: ${d.filename}\n\n${d.markdown}`)
    .join("\n\n");
  return [
    stripped,
    "",
    "## User-provided description",
    "",
    description,
    "",
    docBlocks,
    "",
  ].join("\n");
}

export function assembleStage2Prompt(
  promptBody: string,
  profile: VentureProfile,
): string {
  const stripped = promptBody
    .replace(STAGE_2_DOCUMENTS_PLACEHOLDER, "")
    .trimEnd();
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
