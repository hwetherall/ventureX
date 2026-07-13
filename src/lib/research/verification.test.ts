import { describe, expect, it } from "vitest";

import { ABB_RESEARCH_POLICIES } from "./policies";
import type {
  ProposedCell,
  ResearchEvidence,
  VerificationOutcome,
} from "./types";
import { computeFinalConfidence } from "./verification";

function evidence(
  overrides: Partial<ResearchEvidence> = {},
): ResearchEvidence {
  return {
    provider: "exa",
    url: "https://vertiv.com/product",
    canonicalUrl: "https://vertiv.com/product",
    title: "Vertiv product",
    sourceDomain: "vertiv.com",
    sourceClass: "official_company",
    excerpt: "Vertiv offers a productized busway with plug-in tap-off units.",
    publishedAt: "2026-01-01",
    retrievedAt: "2026-07-12T00:00:00Z",
    disposition: "rejected",
    supportedValuePaths: [],
    candidateMatch: true,
    ...overrides,
  };
}

const verified: VerificationOutcome = {
  supports_exact_value: true,
  candidate_match: true,
  product_scope_match: true,
  freshness_pass: true,
  source_allowed: true,
  contradiction_detected: false,
  unsupported_value_paths: [],
  direct_evidence_indexes: [0],
  inferred_evidence_indexes: [],
  evidence_dates: [],
  reason: "Direct product evidence.",
};

describe("computeFinalConfidence", () => {
  it("accepts an exact direct product claim", () => {
    const proposed: ProposedCell = {
      parameter_key: "busbar_tap_off_offering",
      value: "yes_productized",
      proposed_confidence: "verified",
      reason: null,
      evidence_indexes: [0],
    };
    const result = computeFinalConfidence({
      proposed,
      verification: verified,
      policy: ABB_RESEARCH_POLICIES.busbar_tap_off_offering!,
      evidence: [evidence()],
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(result.confidence).toBe("verified");
    expect(result.value).toBe("yes_productized");
    expect(result.evidence[0]!.disposition).toBe("direct");
  });

  it("rejects inference when the policy forbids it", () => {
    const proposed: ProposedCell = {
      parameter_key: "server_oem_integrator_relationships",
      value: ["NVIDIA"],
      proposed_confidence: "inferred",
      reason: "Adjacent collaboration.",
      evidence_indexes: [0],
    };
    const result = computeFinalConfidence({
      proposed,
      verification: {
        ...verified,
        supports_exact_value: false,
        direct_evidence_indexes: [],
        inferred_evidence_indexes: [0],
        evidence_dates: [],
      },
      policy: ABB_RESEARCH_POLICIES.server_oem_integrator_relationships!,
      evidence: [evidence()],
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(result.confidence).toBe("unknown");
    expect(result.value).toBeNull();
  });

  it("rejects stale evidence even when the model verifier passes it", () => {
    const proposed: ProposedCell = {
      parameter_key: "latest_material_event",
      value: { description: "Old acquisition", date: "2023-01-01" },
      proposed_confidence: "verified",
      reason: null,
      evidence_indexes: [0],
    };
    const result = computeFinalConfidence({
      proposed,
      verification: verified,
      policy: ABB_RESEARCH_POLICIES.latest_material_event!,
      evidence: [evidence({ publishedAt: "2023-01-01" })],
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(result.confidence).toBe("unknown");
  });

  it("does not treat a page publication date as a headcount effective date", () => {
    const proposed: ProposedCell = {
      parameter_key: "headcount",
      value: { value: 160000, as_of: "2026-06-19" },
      proposed_confidence: "verified",
      reason: null,
      evidence_indexes: [0],
    };
    const publicationOnly = computeFinalConfidence({
      proposed,
      verification: {
        ...verified,
        evidence_dates: [
          {
            evidence_index: 0,
            date: "2026-06-19",
            date_kind: "published",
          },
        ],
      },
      policy: ABB_RESEARCH_POLICIES.headcount!,
      evidence: [evidence({ publishedAt: "2026-06-19" })],
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(publicationOnly.confidence).toBe("unknown");

    const effectiveDated = computeFinalConfidence({
      proposed: {
        ...proposed,
        value: { value: 177000, as_of: "2024-12-31" },
      },
      verification: {
        ...verified,
        evidence_dates: [
          {
            evidence_index: 0,
            date: "2024-12-31",
            date_kind: "effective",
          },
        ],
      },
      policy: ABB_RESEARCH_POLICIES.headcount!,
      evidence: [evidence({ publishedAt: null })],
      asOf: "2026-07-12T00:00:00Z",
    });
    expect(effectiveDated.confidence).toBe("verified");
  });
});
