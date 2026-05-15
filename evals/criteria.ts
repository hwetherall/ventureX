/**
 * CLAUDE.md §13 acceptance criteria — codified as pure assertion functions.
 *
 * Each criterion: `{ id, description, check(input) -> { pass, detail } }`.
 * Pure functions, no I/O, no side effects. The runner composes these into
 * structured results; the CLI renders them.
 *
 * Two stages of criteria:
 *   - Stage 1: 8 criteria on a `VentureProfile` (the extraction output)
 *   - Stage 2: 5 criteria on a `Stage2WeightingOutput` (the weights)
 *
 * Originally lived in `scripts/check-abb.ts` and `scripts/check-stage2.ts`
 * as one-off iteration helpers. Those scripts remain useful for ad-hoc
 * checks during prompt tuning; this file is the canonical regression set.
 */

import {
  DIMENSION_KEYS,
  type Dimension,
  type Stage2WeightingOutput,
  type VentureProfile,
} from "@/types/venture-profile";

export interface CriterionResult {
  pass: boolean;
  detail: string;
}

export interface Criterion<TInput> {
  id: string;
  description: string;
  check: (input: TInput) => CriterionResult;
}

// ──────────────────────────────────────────────────────────────────────────
// Stage 1 — VentureProfile criteria (CLAUDE.md §13)
// ──────────────────────────────────────────────────────────────────────────

const REQUIRED_SUBSTITUTION_MECHANISMS: { label: string; aliases: string[] }[] =
  [
    { label: "busbar / tap-off", aliases: ["busbar", "tap-off", "tap off"] },
    { label: "power shelves", aliases: ["power shelf", "power shelves"] },
    { label: "DC distribution", aliases: ["dc distribution"] },
    { label: "in-rack DC", aliases: ["in-rack dc", "in rack dc"] },
    {
      label: "integrated server-mounted power",
      aliases: ["server-mounted", "integrated server", "on-server power"],
    },
  ];

function joinedLower(items: string[]): string {
  return items.join(" | ").toLowerCase();
}

function aliasesPresent(haystack: string, aliases: string[]): boolean {
  return aliases.some((a) => haystack.includes(a.toLowerCase()));
}

export const STAGE_1_CRITERIA: Criterion<VentureProfile>[] = [
  {
    id: "substitution_landscape",
    description:
      "product_solution.substitution_landscape includes busbar/tap-off, power shelves, DC distribution, in-rack DC, and integrated server-mounted power",
    check: (p) => {
      const items = p.dimensions.product_solution.substitution_landscape;
      const hay = joinedLower(items);
      const missing = REQUIRED_SUBSTITUTION_MECHANISMS.filter(
        (m) => !aliasesPresent(hay, m.aliases),
      ).map((m) => m.label);
      return {
        pass: missing.length === 0,
        detail:
          missing.length === 0
            ? `Found all 5 mechanisms across ${items.length} entries.`
            : `Missing: ${missing.join("; ")}. Got: [${items.join(" | ")}]`,
      };
    },
  },
  {
    id: "risk_100_200kw_migration",
    description:
      "strategic_risks_and_uncertainties includes the 100-200kW migration / AI-density risk with non-empty implies_search_for",
    check: (p) => {
      const matches = p.strategic_risks_and_uncertainties.filter((r) => {
        const text = `${r.risk} ${r.implies_search_for}`.toLowerCase();
        return (
          /100\s*[\-–—to ]+\s*200/.test(text) ||
          (text.includes("kw") &&
            (text.includes("migration") ||
              text.includes("density") ||
              text.includes("power density")))
        );
      });
      const passing = matches.find(
        (m) => m.implies_search_for.trim().length > 0,
      );
      return {
        pass: !!passing,
        detail: passing
          ? `Matched: "${passing.risk.slice(0, 120)}…" implies_search_for="${passing.implies_search_for.slice(0, 80)}…"`
          : "No risk mentions 100-200kW migration / power density (or implies_search_for empty)",
      };
    },
  },
  {
    id: "risk_ac_to_dc",
    description:
      "strategic_risks_and_uncertainties includes the AC-to-DC transition risk with non-empty implies_search_for",
    check: (p) => {
      const matches = p.strategic_risks_and_uncertainties.filter((r) => {
        const text = `${r.risk} ${r.implies_search_for}`.toLowerCase();
        return (
          /\bac\b/.test(text) &&
          /\bdc\b/.test(text) &&
          (text.includes("transition") ||
            text.includes("shift") ||
            text.includes("migration") ||
            text.includes("to dc"))
        );
      });
      const passing = matches.find(
        (m) => m.implies_search_for.trim().length > 0,
      );
      return {
        pass: !!passing,
        detail: passing
          ? `Matched: "${passing.risk.slice(0, 120)}…"`
          : "No risk mentions AC-to-DC transition (or implies_search_for empty)",
      };
    },
  },
  {
    id: "geography_china_gap",
    description:
      "geography_regulatory.accessible_market_constraints mentions the China $500M / $75M accessibility gap",
    check: (p) => {
      const items = p.dimensions.geography_regulatory.accessible_market_constraints;
      const hay = joinedLower(items);
      const hasChina = hay.includes("china");
      const hasFigure =
        hay.includes("500") ||
        hay.includes("75") ||
        hay.includes("$500") ||
        hay.includes("$75");
      const pass = hasChina && hasFigure;
      return {
        pass,
        detail: pass
          ? "China + dollar figure both mentioned."
          : `China mentioned: ${hasChina}, $500M/$75M figure: ${hasFigure}. Got: [${items.join(" | ")}]`,
      };
    },
  },
  {
    id: "capital_intensity_high",
    description: "capital_asset.capital_intensity === 'high'",
    check: (p) => {
      const v = p.dimensions.capital_asset.capital_intensity;
      return { pass: v === "high", detail: `Got: ${v}` };
    },
  },
  {
    id: "asset_type_hardware",
    description: "capital_asset.asset_type === 'hardware'",
    check: (p) => {
      const v = p.dimensions.capital_asset.asset_type;
      return { pass: v === "hardware", detail: `Got: ${v}` };
    },
  },
  {
    id: "segment_type_b2b_enterprise",
    description:
      "customers.segment_type is 'B2B-Enterprise' or 'mixed' (B2B-Enterprise dominant)",
    check: (p) => {
      const v = p.dimensions.customers.segment_type;
      return {
        pass: v === "B2B-Enterprise" || v === "mixed",
        detail: `Got: ${v}`,
      };
    },
  },
  {
    id: "anonymization",
    description: "synthetic_description does not contain 'ABB'",
    check: (p) => {
      const desc = p.synthetic_description;
      const leaked = /\babb\b/i.test(desc);
      return {
        pass: !leaked,
        detail: leaked
          ? `Found 'ABB' in: "${desc.slice(0, 200)}…"`
          : "Anonymization OK.",
      };
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Stage 2 — Stage2WeightingOutput criteria (CLAUDE.md §13)
// ──────────────────────────────────────────────────────────────────────────

const HIGH_WEIGHT_FLOOR = 0.15;
const ACCESS_WEIGHT_CEILING = 0.05;
const SUM_TOLERANCE_LOW = 0.97;
const SUM_TOLERANCE_HIGH = 1.03;
const HIGH_WEIGHT_DIMS: Dimension[] = [
  "product_solution",
  "capital_asset",
  "geography_regulatory",
];

export const STAGE_2_CRITERIA: Criterion<Stage2WeightingOutput>[] = [
  {
    id: "sum_within_tolerance",
    description: `7 weights sum within [${SUM_TOLERANCE_LOW}, ${SUM_TOLERANCE_HIGH}]`,
    check: (output) => {
      const sum = DIMENSION_KEYS.reduce(
        (acc, k) => acc + output.weights[k].weight,
        0,
      );
      return {
        pass: sum >= SUM_TOLERANCE_LOW && sum <= SUM_TOLERANCE_HIGH,
        detail: `Sum = ${sum.toFixed(4)}`,
      };
    },
  },
  ...HIGH_WEIGHT_DIMS.map<Criterion<Stage2WeightingOutput>>((dim) => ({
    id: `${dim}_weight_high`,
    description: `${dim} weight ≥ ${HIGH_WEIGHT_FLOOR}`,
    check: (output) => ({
      pass: output.weights[dim].weight >= HIGH_WEIGHT_FLOOR,
      detail: `${dim} weight = ${output.weights[dim].weight.toFixed(3)}`,
    }),
  })),
  {
    id: "access_weight_low",
    description: `access weight ≤ ${ACCESS_WEIGHT_CEILING}`,
    check: (output) => ({
      pass: output.weights.access.weight <= ACCESS_WEIGHT_CEILING,
      detail: `access weight = ${output.weights.access.weight.toFixed(3)}`,
    }),
  },
];
