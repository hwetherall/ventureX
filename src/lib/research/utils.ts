import { createHash } from "node:crypto";

import { UnsafeResearchUrlError } from "./errors";
import type {
  ResearchProviderName,
  SourceClass,
} from "./types";
import { ResearchBudgetError } from "./errors";

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

export function sanitizeResearchText(value: string, max = 100_000): string {
  return value
    .replace(/\0/gu, "")
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
      "�",
    )
    .slice(0, max);
}

export function canonicalizeResearchUrl(raw: string): string {
  const url = validatePublicResearchUrl(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^utm_/iu.test(key) ||
      ["gclid", "fbclid", "mc_cid", "mc_eid", "ref", "source"].includes(
        key.toLowerCase(),
      )
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

export function validatePublicResearchUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeResearchUrlError(raw, "invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeResearchUrlError(raw, "protocol must be http or https");
  }
  if (url.username || url.password) {
    throw new UnsafeResearchUrlError(raw, "embedded credentials are forbidden");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "169.254.169.254" ||
    PRIVATE_IPV4.some((pattern) => pattern.test(host))
  ) {
    throw new UnsafeResearchUrlError(raw, "private or local host");
  }
  return url;
}

export function researchContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function domainForUrl(raw: string): string {
  return validatePublicResearchUrl(raw).hostname.toLowerCase();
}

export function inferSourceClass(
  url: string,
  candidateDomains: string[],
): SourceClass {
  const host = domainForUrl(url);
  if (
    candidateDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  ) {
    return "official_company";
  }
  if (
    host === "sec.gov" ||
    host.endsWith(".sec.gov") ||
    host === "gleif.org" ||
    host.endsWith(".gleif.org") ||
    host.endsWith("companieshouse.gov.uk") ||
    host.endsWith("company-information.service.gov.uk")
  ) {
    return host.includes("sec.gov") ? "official_filing" : "official_registry";
  }
  if (
    host.includes("reuters.com") ||
    host.includes("apnews.com") ||
    host.includes("businesswire.com") ||
    host.includes("prnewswire.com")
  ) {
    return "news";
  }
  return "other";
}

export function reserveResearchBudget(
  budget: { spentUsd: number; hardCapUsd: number },
  estimatedNextUsd: number,
): void {
  if (budget.spentUsd + estimatedNextUsd > budget.hardCapUsd) {
    throw new ResearchBudgetError(
      budget.spentUsd,
      estimatedNextUsd,
      budget.hardCapUsd,
    );
  }
}

export function providerCostEstimate(provider: ResearchProviderName): number {
  switch (provider) {
    case "exa":
      return 0.007;
    case "brave":
      return 0.005;
    case "bright_data":
      return 0.0015;
    case "perplexity":
      return 1;
    case "openrouter":
      return 0.25;
    default:
      return 0;
  }
}
