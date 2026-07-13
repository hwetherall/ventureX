import { describe, expect, it } from "vitest";

import type { Parameter } from "@/types/parameter";

import {
  ABB_RESEARCH_POLICIES,
  getResearchPolicy,
  renderPolicyQueries,
} from "./policies";

const KEYS = [
  "legal_name",
  "headcount",
  "latest_material_event",
  "core_offering",
  "pricing_disclosure",
  "sales_cycle_length",
  "rd_capacity",
  "busbar_tap_off_offering",
  "server_oem_integrator_relationships",
  "hyperscaler_reference_wins",
];

describe("ABB V2 research policies", () => {
  it("defines exactly the frozen ten parameters with bounded work", () => {
    expect(Object.keys(ABB_RESEARCH_POLICIES).sort()).toEqual([...KEYS].sort());
    for (const policy of Object.values(ABB_RESEARCH_POLICIES)) {
      expect(policy.maximumAttempts).toBeLessThanOrEqual(2);
      expect(policy.maximumSearches).toBeLessThanOrEqual(4);
      expect(policy.maximumFetchedPages).toBeLessThanOrEqual(6);
      expect(policy.maximumCostUsd).toBeLessThanOrEqual(0.75);
      expect(policy.proofRule.length).toBeGreaterThan(30);
    }
  });

  it("rejects the known loose value shapes", () => {
    expect(
      ABB_RESEARCH_POLICIES.latest_material_event!.validateValue({
        description: "Launch",
        date: "last week",
      }).pass,
    ).toBe(false);
    expect(
      ABB_RESEARCH_POLICIES.busbar_tap_off_offering!.validateValue("yes").pass,
    ).toBe(false);
    expect(
      ABB_RESEARCH_POLICIES.server_oem_integrator_relationships!.validateValue(
        "NVIDIA",
      ).pass,
    ).toBe(false);
  });

  it("renders candidate, domain, product, and date into queries", () => {
    const queries = renderPolicyQueries({
      policy: ABB_RESEARCH_POLICIES.latest_material_event!,
      candidate: {
        candidateId: "c",
        name: "Vertiv Holdings",
        aliases: ["Vertiv"],
        domains: ["vertiv.com"],
      },
      asOf: "2026-07-12T00:00:00Z",
      productHint: "rack PDU",
    });
    expect(queries.join(" ")).toContain("Vertiv Holdings");
    expect(queries.join(" ")).toContain("vertiv.com");
    expect(queries.join(" ")).toContain("2025-07-12");
  });

  it("fails closed for an unapproved parameter", () => {
    const parameter = {
      id: "unknown_parameter",
    } as Parameter;
    expect(() => getResearchPolicy(parameter)).toThrow(/no approved policy/u);
  });
});
