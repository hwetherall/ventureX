import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import { loadPrompt } from "@/lib/prompts";

import type {
  CandidateIdentity,
  ProposedCell,
  ResearchEvidence,
  ResearchPolicy,
} from "./types";
import { ProposedCellSchema } from "./types";

const PROMPT = "stage_5_v2_extract_evidence.md";

export async function extractCellFromEvidence(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateIdentity;
  parameter: {
    id: string;
    name: string;
    value_type: string;
    value_schema?: Record<string, unknown>;
    prompt_hint: string;
  };
  policy: ResearchPolicy;
  evidence: ResearchEvidence[];
  asOf: string;
  model?: string;
}): Promise<{
  proposed: ProposedCell;
  costUsd: number;
  latencyMs: number;
  llmCallId: string;
  model: string;
}> {
  const promptBody = await loadPrompt(PROMPT);
  const prompt = [
    promptBody,
    "",
    "## As-of date",
    args.asOf,
    "",
    "## Candidate identity",
    JSON.stringify(args.candidate, null, 2),
    "",
    "## Parameter",
    JSON.stringify(args.parameter, null, 2),
    "",
    "## Research policy",
    JSON.stringify(
      {
        proof_rule: args.policy.proofRule,
        inference: args.policy.inference,
        source_preference: args.policy.sourcePreference,
        freshness: args.policy.freshness ?? null,
      },
      null,
      2,
    ),
    "",
    "## Evidence records",
    JSON.stringify(
      args.evidence.map((item, index) => ({
        evidence_index: index,
        provider: item.provider,
        url: item.url,
        title: item.title,
        source_class: item.sourceClass,
        published_at: item.publishedAt ?? null,
        effective_at: item.effectiveAt ?? null,
        candidate_match: item.candidateMatch,
        content: (item.fullContent || item.excerpt).slice(0, 12_000),
      })),
      null,
      2,
    ),
  ].join("\n");
  const model =
    args.model ??
    process.env.CELL_RESEARCH_EXTRACT_MODEL ??
    process.env.STAGE_1_MODEL ??
    "anthropic/claude-sonnet-4.6";
  const result = await callLLM<ProposedCell>({
    insforge: args.insforge,
    model,
    stage: "stage_5_v2_extract",
    prompt,
    ventureId: args.ventureId,
    runId: null,
    schema: ProposedCellSchema,
    timeoutMs: 90_000,
    estimatedOutputTokens: 600,
    maxTokens: 1_500,
  });
  return {
    proposed: result.data,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    llmCallId: result.llmCallId,
    model,
  };
}
