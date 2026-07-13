import type { Parameter } from "@/types/parameter";

import type {
  CandidateIdentity,
  PolicyValidationResult,
  ResearchPolicy,
} from "./types";

const ok = (reason = "value shape accepted"): PolicyValidationResult => ({
  pass: true,
  reason,
});
const fail = (reason: string): PolicyValidationResult => ({
  pass: false,
  reason,
});

function nonEmptyString(value: unknown): PolicyValidationResult {
  return typeof value === "string" && value.trim().length > 0
    ? ok()
    : fail("expected a non-empty string");
}

function meaningfulText(value: unknown): PolicyValidationResult {
  return typeof value === "string" && value.trim().length >= 12
    ? ok()
    : fail("expected at least 12 characters of meaningful text");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function datedObject(value: unknown): PolicyValidationResult {
  const obj = objectValue(value);
  if (!obj) return fail("expected an object");
  const description = obj.description;
  const date = obj.date;
  if (typeof description !== "string" || description.trim().length < 5) {
    return fail("missing material-event description");
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return fail("material-event date must be YYYY-MM-DD");
  }
  return Number.isNaN(Date.parse(date)) ? fail("invalid event date") : ok();
}

function headcountObject(value: unknown): PolicyValidationResult {
  const obj = objectValue(value);
  if (!obj) return fail("expected headcount object");
  if (
    (typeof obj.value !== "number" && typeof obj.value !== "string") ||
    (typeof obj.value === "number" && obj.value <= 0)
  ) {
    return fail("headcount value must be a positive number or labelled estimate");
  }
  if (typeof obj.as_of !== "string" || Number.isNaN(Date.parse(obj.as_of))) {
    return fail("headcount requires a valid as_of date");
  }
  return ok();
}

function pricingObject(value: unknown): PolicyValidationResult {
  const obj = objectValue(value);
  if (!obj) return fail("expected pricing disclosure object");
  if (
    typeof obj.disclosure !== "string" ||
    !["public", "partial", "opaque", "unknown"].includes(obj.disclosure)
  ) {
    return fail("pricing disclosure must be public, partial, opaque, or unknown");
  }
  return ok();
}

function rdValue(value: unknown): PolicyValidationResult {
  if (typeof value === "string") return meaningfulText(value);
  const obj = objectValue(value);
  return obj && Object.keys(obj).length > 0
    ? ok()
    : fail("expected R&D spend, center, headcount, patent, or capacity evidence");
}

function listOfNames(value: unknown): PolicyValidationResult {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 1)
    ? ok()
    : fail("expected a non-empty list of named organizations");
}

function busbarValue(value: unknown): PolicyValidationResult {
  return typeof value === "string" &&
    ["yes_productized", "no", "unknown"].includes(value)
    ? ok()
    : fail("expected yes_productized, no, or unknown");
}

const BASE_LIMITS = {
  maximumAttempts: 2,
  maximumSearches: 4,
  maximumFetchedPages: 4,
  maximumCostUsd: 0.5,
} as const;

export const ABB_RESEARCH_POLICIES: Record<string, ResearchPolicy> = {
  legal_name: {
    parameterKey: "legal_name",
    officialProviders: ["gleif", "sec_edgar", "companies_house"],
    sourcePreference: [
      "official_registry",
      "official_filing",
      "official_company",
    ],
    queryTemplates: [
      '"{candidate}" legal entity name',
      'site:{domain} "{candidate}" legal name',
    ],
    proofRule:
      "The source must explicitly identify the registered legal entity corresponding to the candidate. A trading name alone is insufficient.",
    inference: "forbidden",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    maximumSearches: 2,
    maximumFetchedPages: 2,
    maximumCostUsd: 0.1,
    validateValue: nonEmptyString,
  },
  headcount: {
    parameterKey: "headcount",
    officialProviders: ["sec_edgar"],
    sourcePreference: [
      "official_filing",
      "official_company",
      "industry_analyst",
      "news",
    ],
    queryTemplates: [
      '"{candidate}" employees annual report',
      'site:{domain} "employees" "annual report"',
      '"{candidate}" headcount employees {year}',
    ],
    freshness: { maxAgeDays: 900, requiredEvidenceDateKind: "effective" },
    proofRule:
      "Evidence must state an employee count or clearly labelled estimate and the date or fiscal period it applies to.",
    inference: "allowed",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: headcountObject,
  },
  latest_material_event: {
    parameterKey: "latest_material_event",
    officialProviders: ["sec_edgar"],
    sourcePreference: ["official_filing", "official_company", "news"],
    queryTemplates: [
      '"{candidate}" latest news acquisition launch contract',
      'site:{domain} (news OR press OR investor) "{year}"',
      '"{candidate}" material event after:{date_from}',
    ],
    freshness: {
      dateWindow: "rolling_12_months",
      publicationDateRequired: true,
    },
    proofRule:
      "The event and date must be directly supported, fall inside the rolling twelve-month window, and be plausibly material to company scale, control, strategy, product, or operations.",
    inference: "allowed",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    maximumFetchedPages: 5,
    validateValue: datedObject,
  },
  core_offering: {
    parameterKey: "core_offering",
    officialProviders: [],
    sourcePreference: [
      "official_company",
      "official_partner",
      "authorized_distributor",
      "industry_analyst",
    ],
    queryTemplates: [
      'site:{domain} "{product}" product datasheet',
      '"{candidate}" "{product}" offering',
      '"{candidate}" product catalog data center power',
    ],
    proofRule:
      "The source must explicitly describe the candidate's relevant product or service. Product existence cannot be inferred from an adjacent market position.",
    inference: "allowed",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: meaningfulText,
  },
  pricing_disclosure: {
    parameterKey: "pricing_disclosure",
    officialProviders: [],
    sourcePreference: [
      "official_company",
      "authorized_distributor",
      "official_partner",
    ],
    queryTemplates: [
      'site:{domain} "{product}" (price OR pricing OR quote)',
      '"{candidate}" "{product}" price distributor',
      '"{candidate}" "contact sales" "{product}"',
    ],
    proofRule:
      "A public/partial price requires an explicit price or range. Opaque pricing requires either explicit quote/contact-sales evidence or a documented bounded search and must be labelled inferred.",
    inference: "expected",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: pricingObject,
  },
  sales_cycle_length: {
    parameterKey: "sales_cycle_length",
    officialProviders: [],
    sourcePreference: [
      "official_company",
      "official_partner",
      "authorized_distributor",
      "industry_analyst",
      "news",
    ],
    queryTemplates: [
      '"{candidate}" "{product}" implementation timeline',
      '"{candidate}" customer case study deployment months',
      '"{candidate}" procurement installation lead time "{product}"',
    ],
    proofRule:
      "Verified requires an explicit duration or dated milestones for a relevant sale or deployment. General enterprise-sales intuition is not direct evidence.",
    inference: "expected",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: meaningfulText,
  },
  rd_capacity: {
    parameterKey: "rd_capacity",
    officialProviders: ["sec_edgar"],
    sourcePreference: [
      "official_filing",
      "official_company",
      "official_registry",
      "industry_analyst",
    ],
    queryTemplates: [
      '"{candidate}" research development expense annual report',
      'site:{domain} (R&D OR "research and development") (center OR spend OR patents)',
      '"{candidate}" R&D centers patents engineering research',
    ],
    freshness: { maxAgeDays: 1_200 },
    proofRule:
      "Evidence must disclose R&D spend, a named R&D center, R&D headcount, relevant patents, or another explicit research-capacity fact. Manufacturing expansion alone is rejected.",
    inference: "allowed",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: rdValue,
  },
  busbar_tap_off_offering: {
    parameterKey: "busbar_tap_off_offering",
    officialProviders: [],
    sourcePreference: ["official_company", "authorized_distributor"],
    queryTemplates: [
      'site:{domain} (busbar OR busway) (tap-off OR "tap off" OR "tap box" OR "tap unit")',
      '"{candidate}" busbar tap-off datasheet',
      '"{candidate}" busway tap box product',
    ],
    proofRule:
      "yes_productized requires explicit product evidence for both a busbar/busway and a tap-off, tap box, or tap unit. A generic busbar alone is insufficient.",
    inference: "forbidden",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    validateValue: busbarValue,
  },
  server_oem_integrator_relationships: {
    parameterKey: "server_oem_integrator_relationships",
    officialProviders: [],
    sourcePreference: [
      "official_company",
      "official_partner",
      "news",
    ],
    queryTemplates: [
      '"{candidate}" (Dell OR HPE OR Lenovo OR Supermicro) partnership rack PDU',
      'site:{domain} (OEM OR integrator OR reseller OR partner) "{product}"',
      '"{candidate}" server OEM integration power distribution',
    ],
    proofRule:
      "The evidence must name a server OEM or IT integrator and explicitly describe a relevant commercial, integration, resale, bundle, or deployment relationship. A technology collaboration with a component/platform vendor is not enough.",
    inference: "forbidden",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    maximumFetchedPages: 5,
    validateValue: listOfNames,
  },
  hyperscaler_reference_wins: {
    parameterKey: "hyperscaler_reference_wins",
    officialProviders: [],
    sourcePreference: [
      "official_company",
      "official_partner",
      "news",
    ],
    queryTemplates: [
      '"{candidate}" (AWS OR Azure OR Google OR Meta OR Oracle OR Equinix OR "Digital Realty" OR NTT) "{product}"',
      'site:{domain} customer case study (hyperscale OR colocation) "{product}"',
      '"{candidate}" named customer deployment rack power distribution',
    ],
    proofRule:
      "The evidence must name an allowed hyperscaler or major colocation customer and explicitly connect that customer to deployment or use of the relevant product category. Adjacent cooling, campus tenancy, or general partnership evidence is rejected.",
    inference: "forbidden",
    minimumDirectSources: 1,
    ...BASE_LIMITS,
    maximumFetchedPages: 6,
    maximumCostUsd: 0.75,
    validateValue: listOfNames,
  },
};

export function getResearchPolicy(parameter: Parameter): ResearchPolicy {
  const policy = ABB_RESEARCH_POLICIES[parameter.id];
  if (!policy) {
    throw new Error(
      `Cell Research V2 has no approved policy for parameter '${parameter.id}'.`,
    );
  }
  return policy;
}

export function renderPolicyQueries(args: {
  policy: ResearchPolicy;
  candidate: CandidateIdentity;
  asOf: string;
  productHint?: string;
}): string[] {
  const domain = args.candidate.domains[0] ?? "example.invalid";
  const dateFrom = rollingDate(args.asOf, 365);
  const year = new Date(args.asOf).getUTCFullYear();
  const product = args.productHint ?? "rack PDU power distribution";
  return args.policy.queryTemplates
    .map((template) =>
      template
        .replaceAll("{candidate}", args.candidate.name)
        .replaceAll("{domain}", domain)
        .replaceAll("{date_from}", dateFrom)
        .replaceAll("{year}", String(year))
        .replaceAll("{product}", product),
    )
    .filter((query) => !query.includes("example.invalid"))
    .slice(0, args.policy.maximumSearches);
}

export function rollingDate(asOf: string, days: number): string {
  const date = new Date(asOf);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
