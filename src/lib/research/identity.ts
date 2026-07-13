import type { CandidateIdentity } from "./types";

const COMPANY_SUFFIXES =
  /\b(incorporated|inc|corporation|corp|company|co|plc|limited|ltd|llc|gmbh|se|sa|ag|holdings?)\b/giu;

export function normalizeCompanyIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

export function uniqueAliases(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const normalized = normalizeCompanyIdentity(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
  }
  return out;
}

export function textMatchesCandidate(
  text: string,
  candidate: CandidateIdentity,
): boolean {
  const normalizedText = normalizeCompanyIdentity(text);
  return [candidate.name, candidate.legalName, ...candidate.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normalizeCompanyIdentity)
    .filter((value) => value.length >= 3)
    .some((alias) => normalizedText.includes(alias));
}

export function candidateDomainsFromCitations(
  raw: unknown,
  fallback: string[] = [],
): string[] {
  const domains = new Set(fallback.map((value) => value.toLowerCase()));
  if (!Array.isArray(raw)) return expandVerifiedOfficialDomains([...domains]);
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const url = (entry as { url?: unknown }).url;
    if (typeof url !== "string") continue;
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
      if (host && !THIRD_PARTY_EVIDENCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        domains.add(host);
      }
    } catch {
      // Ignore malformed historical citations.
    }
  }
  return expandVerifiedOfficialDomains([...domains]);
}

/**
 * Evidence-backed corporate-domain aliases. These are identity metadata, not
 * generic suffix guesses: a short corporate domain must never become official
 * merely because a candidate name appears on the page.
 *
 * Production identity resolution should persist these aliases per company.
 * The registry keeps the ABB PoC deterministic until that enrichment exists.
 */
const VERIFIED_OFFICIAL_DOMAIN_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["schneider-electric.com", "se.com"],
];

export function expandVerifiedOfficialDomains(domains: string[]): string[] {
  const expanded = new Set(domains.map(normalizeDomain));
  for (const group of VERIFIED_OFFICIAL_DOMAIN_GROUPS) {
    if (
      group.some((member) =>
        [...expanded].some(
          (domain) => domain === member || domain.endsWith(`.${member}`),
        ),
      )
    ) {
      for (const member of group) expanded.add(member);
    }
  }
  return [...expanded];
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

const THIRD_PARTY_EVIDENCE_DOMAINS = [
  "prnewswire.com",
  "businesswire.com",
  "reuters.com",
  "apnews.com",
  "wikipedia.org",
  "linkedin.com",
  "youtube.com",
];
