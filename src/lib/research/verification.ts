import type { InsForgeClient } from "@/lib/insforge/server";
import { callLLM } from "@/lib/openrouter/call";
import { loadPrompt } from "@/lib/prompts";

import type {
  CandidateIdentity,
  ProposedCell,
  ResearchConfidence,
  ResearchEvidence,
  ResearchPolicy,
  VerificationOutcome,
} from "./types";
import { VerificationOutcomeSchema } from "./types";

const PROMPT = "stage_5_v2_verify_claim.md";

export async function verifyCellEvidence(args: {
  insforge: InsForgeClient;
  ventureId: string;
  candidate: CandidateIdentity;
  parameter: { id: string; name: string; value_type: string };
  policy: ResearchPolicy;
  proposed: ProposedCell;
  evidence: ResearchEvidence[];
  asOf: string;
}): Promise<{
  verification: VerificationOutcome;
  costUsd: number;
  latencyMs: number;
  llmCallId: string;
}> {
  const promptBody = await loadPrompt(PROMPT);
  const prompt = [
    promptBody,
    "",
    "## As-of date",
    args.asOf,
    "",
    "## Candidate",
    JSON.stringify(args.candidate, null, 2),
    "",
    "## Parameter and proof rule",
    JSON.stringify(
      {
        ...args.parameter,
        proof_rule: args.policy.proofRule,
        inference: args.policy.inference,
        source_preference: args.policy.sourcePreference,
        freshness: args.policy.freshness ?? null,
        minimum_direct_sources: args.policy.minimumDirectSources,
      },
      null,
      2,
    ),
    "",
    "## Proposed value (the extractor confidence is intentionally omitted)",
    JSON.stringify(
      {
        parameter_key: args.proposed.parameter_key,
        value: args.proposed.value,
        reason: args.proposed.reason,
      },
      null,
      2,
    ),
    "",
    "## Evidence",
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
        excerpt: item.excerpt,
        content: item.fullContent?.slice(0, 8_000),
      })),
      null,
      2,
    ),
  ].join("\n");
  const result = await callLLM<VerificationOutcome>({
    insforge: args.insforge,
    model:
      process.env.CELL_RESEARCH_VERIFY_MODEL ??
      process.env.STAGE_1_CRITIC_MODEL ??
      "openai/gpt-5.5",
    stage: "stage_5_v2_verify",
    prompt,
    ventureId: args.ventureId,
    runId: null,
    schema: VerificationOutcomeSchema,
    timeoutMs: 90_000,
    estimatedOutputTokens: 500,
    maxTokens: 1_500,
  });
  return {
    verification: result.data,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    llmCallId: result.llmCallId,
  };
}

export function computeFinalConfidence(args: {
  proposed: ProposedCell;
  verification: VerificationOutcome;
  policy: ResearchPolicy;
  evidence: ResearchEvidence[];
  asOf: string;
}): {
  confidence: ResearchConfidence;
  value: unknown | null;
  reason: string;
  evidence: ResearchEvidence[];
} {
  const valueValidation = args.policy.validateValue(args.proposed.value);
  if (args.proposed.value === null || args.proposed.proposed_confidence === "unknown") {
    return {
      confidence: "unknown",
      value: null,
      reason: args.proposed.reason ?? "extractor returned unknown",
      evidence: markEvidence(args.evidence, args.verification, "rejected"),
    };
  }
  const inferenceSupported =
    args.policy.inference !== "forbidden" &&
    args.verification.inferred_evidence_indexes.length > 0;
  const verificationPass =
    valueValidation.pass &&
    (args.verification.supports_exact_value || inferenceSupported) &&
    args.verification.candidate_match &&
    args.verification.product_scope_match &&
    args.verification.freshness_pass &&
    args.verification.source_allowed &&
    !args.verification.contradiction_detected &&
    args.verification.unsupported_value_paths.length === 0;
  if (!verificationPass) {
    return {
      confidence: "unknown",
      value: null,
      reason: `verification_failed: ${valueValidation.pass ? args.verification.reason : valueValidation.reason}`,
      evidence: markEvidence(args.evidence, args.verification, "rejected"),
    };
  }
  const directIndexes = new Set(
    args.verification.direct_evidence_indexes.filter((index) =>
      evidencePassesDeterministicPolicy(
        args.evidence[index],
        args.policy,
        args.asOf,
        args.verification.evidence_dates.filter(
          (item) => item.evidence_index === index,
        ),
      ),
    ),
  );
  const inferredIndexes = new Set(
    args.verification.inferred_evidence_indexes.filter((index) =>
      evidencePassesDeterministicPolicy(
        args.evidence[index],
        args.policy,
        args.asOf,
        args.verification.evidence_dates.filter(
          (item) => item.evidence_index === index,
        ),
      ),
    ),
  );
  const directCount = directIndexes.size;
  const mayInfer = args.policy.inference !== "forbidden";
  const confidence: ResearchConfidence =
    directCount >= args.policy.minimumDirectSources
      ? "verified"
      : mayInfer && inferredIndexes.size > 0
        ? "inferred"
        : "unknown";
  return {
    confidence,
    value: confidence === "unknown" ? null : args.proposed.value,
    reason:
      confidence === "unknown"
        ? "verification_failed: minimum direct evidence not met and no accepted inferred evidence was available"
        : args.verification.reason,
    evidence: args.evidence.map((item, index) => {
      const verifiedDates = args.verification.evidence_dates.filter(
        (entry) => entry.evidence_index === index,
      );
      const publishedDate = verifiedDates.find(
        (entry) => entry.date_kind === "published",
      );
      const effectiveDate = verifiedDates.find(
        (entry) => entry.date_kind === "effective",
      );
      return {
        ...item,
        publishedAt:
          item.publishedAt ??
          publishedDate?.date ?? null,
        effectiveAt:
          item.effectiveAt ??
          effectiveDate?.date ?? null,
        disposition: directIndexes.has(index)
          ? ("direct" as const)
          : inferredIndexes.has(index)
            ? ("inferred" as const)
            : ("rejected" as const),
        supportedValuePaths:
          directIndexes.has(index) || inferredIndexes.has(index)
            ? ["$"]
            : [],
        verifierReason: args.verification.reason,
      };
    }),
  };
}

function evidencePassesDeterministicPolicy(
  evidence: ResearchEvidence | undefined,
  policy: ResearchPolicy,
  asOf: string,
  verifiedDates: Array<{
    date: string;
    date_kind: "published" | "effective";
  }> = [],
): boolean {
  if (!evidence || evidence.candidateMatch === false) return false;
  if (!policy.sourcePreference.includes(evidence.sourceClass)) return false;
  const freshness = policy.freshness;
  if (!freshness) return true;
  const verifiedPublished = verifiedDates.find(
    (item) => item.date_kind === "published",
  )?.date;
  const verifiedEffective = verifiedDates.find(
    (item) => item.date_kind === "effective",
  )?.date;
  const publishedDate = evidence.publishedAt ?? verifiedPublished;
  const effectiveDate = evidence.effectiveAt ?? verifiedEffective;
  if (freshness.publicationDateRequired && !publishedDate) return false;
  const dateValue =
    freshness.requiredEvidenceDateKind === "published"
      ? publishedDate
      : freshness.requiredEvidenceDateKind === "effective"
        ? effectiveDate
        : publishedDate ?? effectiveDate;
  if (freshness.requiredEvidenceDateKind && !dateValue) return false;
  if (!dateValue || Number.isNaN(Date.parse(dateValue))) {
    return !freshness.publicationDateRequired;
  }
  const ageDays =
    (Date.parse(asOf) - Date.parse(dateValue)) / (24 * 60 * 60 * 1000);
  if (ageDays < 0) return false;
  if (freshness.dateWindow === "rolling_12_months" && ageDays > 365) {
    return false;
  }
  if (freshness.maxAgeDays !== undefined && ageDays > freshness.maxAgeDays) {
    return false;
  }
  return true;
}

function markEvidence(
  evidence: ResearchEvidence[],
  verification: VerificationOutcome,
  disposition: "rejected",
): ResearchEvidence[] {
  return evidence.map((item) => ({
    ...item,
    disposition,
    supportedValuePaths: [],
    verifierReason: verification.reason,
  }));
}
