/**
 * ABB Rack PDU Section 13 acceptance script.
 *
 * Manual helper for M7 prompt iteration. Reads a profile JSON from disk and
 * asserts the 6 ABB-specific criteria from claude.md §13. Will be absorbed
 * into the M11 eval framework — keep it simple.
 *
 * Usage:
 *   pnpm tsx scripts/check-abb.ts <path-to-profile.json>
 *
 * Where the input file is the `profile_json` cell from the latest
 * `profile_versions` row for the ABB venture. Export from the InsForge
 * dashboard, save as JSON, point this at it. Tolerates both bare profile
 * JSON and `{ profile_json: {...} }` wrappers.
 *
 * Exit codes: 0 = all criteria pass, 2 = one or more failed, 1 = bad input.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  VentureProfileSchema,
  type VentureProfile,
} from "@/types/venture-profile";

interface CriterionResult {
  pass: boolean;
  detail: string;
}

interface Criterion {
  id: string;
  description: string;
  check: (profile: VentureProfile) => CriterionResult;
}

// Each entry: one substitution mechanism + aliases that should match it. The
// LLM may phrase any one of these — we just need one alias per mechanism to
// appear *somewhere* in the substitution_landscape list.
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

const CRITERIA: Criterion[] = [
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
      "strategic_risks_and_uncertainties includes the 100-200kW migration risk with non-empty implies_search_for",
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
          ? `Matched: "${passing.risk.slice(0, 100)}…" implies_search_for="${passing.implies_search_for.slice(0, 80)}…"`
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
          ? `Matched: "${passing.risk.slice(0, 100)}…"`
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
        hay.includes("500") || hay.includes("75") || hay.includes("$500") || hay.includes("$75");
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
      return {
        pass: v === "high",
        detail: `Got: ${v}`,
      };
    },
  },
  {
    id: "asset_type_hardware",
    description: "capital_asset.asset_type === 'hardware'",
    check: (p) => {
      const v = p.dimensions.capital_asset.asset_type;
      return {
        pass: v === "hardware",
        detail: `Got: ${v}`,
      };
    },
  },
  {
    id: "segment_type_b2b_enterprise",
    description:
      "customers.segment_type is 'B2B-Enterprise' or 'mixed' (with B2B-Enterprise expected dominant)",
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

async function loadProfile(profilePath: string): Promise<VentureProfile> {
  const raw = await fs.readFile(profilePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  // Tolerate both bare profile JSON and a `{ profile_json: {...} }` wrapper
  // (which is the shape of a `profile_versions` row exported as JSON).
  const candidate =
    typeof parsed === "object" &&
    parsed !== null &&
    "profile_json" in parsed
      ? (parsed as { profile_json: unknown }).profile_json
      : parsed;
  return VentureProfileSchema.parse(candidate);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: pnpm tsx scripts/check-abb.ts <path-to-profile.json>",
    );
    console.error(
      "Export the `profile_json` cell from the latest profile_versions row for the ABB venture.",
    );
    process.exit(1);
  }

  const profilePath = path.resolve(arg);

  let profile: VentureProfile;
  try {
    profile = await loadProfile(profilePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load / validate profile from ${profilePath}:`);
    console.error(msg);
    process.exit(1);
  }

  console.log("");
  console.log(`ABB Section 13 acceptance check — ${path.basename(profilePath)}`);
  console.log("");

  let passing = 0;
  for (const c of CRITERIA) {
    const result = c.check(profile);
    const tag = result.pass ? "PASS" : "FAIL";
    console.log(`[${tag}] ${c.id}`);
    console.log(`       ${c.description}`);
    console.log(`       → ${result.detail}`);
    console.log("");
    if (result.pass) passing++;
  }

  const total = CRITERIA.length;
  console.log("----------------------------------------");
  console.log(`${passing}/${total} criteria passed`);

  if (passing < total) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
