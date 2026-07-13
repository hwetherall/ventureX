import { textMatchesCandidate } from "./identity";
import type {
  CandidateIdentity,
  OfficialFact,
  ResearchEvidence,
  ResearchPolicy,
  SearchHit,
  SourceClass,
} from "./types";
import {
  canonicalizeResearchUrl,
  domainForUrl,
  inferSourceClass,
  researchContentHash,
  sanitizeResearchText,
} from "./utils";

export interface RankedSearchHit extends SearchHit {
  canonicalUrl: string;
  sourceClass: SourceClass;
  candidateMatch: boolean;
  researchScore: number;
}

export function mergeAndRankSearchHits(args: {
  hits: SearchHit[];
  candidate: CandidateIdentity;
  policy: ResearchPolicy;
  asOf: string;
}): RankedSearchHit[] {
  const byUrl = new Map<string, RankedSearchHit>();
  for (const hit of args.hits) {
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeResearchUrl(hit.url);
    } catch {
      continue;
    }
    const sourceClass = inferSourceClass(
      canonicalUrl,
      args.candidate.domains,
    );
    const candidateMatch = textMatchesCandidate(
      `${hit.title} ${hit.snippet}`,
      args.candidate,
    );
    const sourceIndex = args.policy.sourcePreference.indexOf(sourceClass);
    let researchScore = sourceIndex >= 0 ? 20 - sourceIndex * 3 : 1;
    if (candidateMatch) researchScore += 15;
    if (sourceClass.startsWith("official_")) researchScore += 5;
    if (hit.provider === "brave") researchScore += 1;
    if (hit.publishedAt && !Number.isNaN(Date.parse(hit.publishedAt))) {
      const ageDays =
        (Date.parse(args.asOf) - Date.parse(hit.publishedAt)) /
        (24 * 60 * 60 * 1000);
      if (ageDays >= 0 && ageDays <= 365) researchScore += 4;
    }
    const ranked: RankedSearchHit = {
      ...hit,
      canonicalUrl,
      sourceClass,
      candidateMatch,
      researchScore,
    };
    const existing = byUrl.get(canonicalUrl);
    if (!existing || ranked.researchScore > existing.researchScore) {
      byUrl.set(canonicalUrl, ranked);
    }
  }
  return [...byUrl.values()].sort(
    (a, b) => b.researchScore - a.researchScore || a.rank - b.rank,
  );
}

export function officialFactToEvidence(args: {
  fact: OfficialFact;
  candidate: CandidateIdentity;
  retrievedAt: string;
}): ResearchEvidence {
  const canonicalUrl = canonicalizeResearchUrl(args.fact.url);
  return {
    provider: args.fact.provider,
    providerRequestId: args.fact.providerRequestId ?? null,
    url: args.fact.url,
    canonicalUrl,
    title: sanitizeResearchText(args.fact.title, 500),
    sourceDomain: domainForUrl(canonicalUrl),
    sourceClass: args.fact.sourceClass,
    excerpt: sanitizeResearchText(args.fact.excerpt, 6_000),
    fullContent: JSON.stringify(args.fact.value),
    publishedAt: args.fact.publishedAt ?? null,
    effectiveAt: args.fact.effectiveAt ?? null,
    retrievedAt: args.retrievedAt,
    searchQuery: null,
    resultRank: null,
    contentHash: researchContentHash(
      `${args.fact.excerpt}\n${JSON.stringify(args.fact.value)}`,
    ),
    candidateMatch: true,
    disposition: "rejected",
    supportedValuePaths: [],
    verifierReason: null,
  };
}

export function fetchedHitToEvidence(args: {
  hit: RankedSearchHit;
  content: string;
  title?: string;
  provider: "exa" | "bright_data";
  providerRequestId?: string | null;
  publishedAt?: string | null;
  retrievedAt: string;
}): ResearchEvidence {
  const content = sanitizeResearchText(args.content, 50_000);
  return {
    provider: args.provider,
    providerRequestId: args.providerRequestId ?? null,
    url: args.hit.url,
    canonicalUrl: args.hit.canonicalUrl,
    title: sanitizeResearchText(args.title || args.hit.title, 500),
    sourceDomain: domainForUrl(args.hit.canonicalUrl),
    sourceClass: args.hit.sourceClass,
    excerpt: sanitizeResearchText(args.hit.snippet || content, 6_000),
    fullContent: content,
    publishedAt: args.publishedAt ?? args.hit.publishedAt ?? null,
    effectiveAt: null,
    retrievedAt: args.retrievedAt,
    searchQuery: args.hit.searchQuery ?? null,
    resultRank: args.hit.rank,
    contentHash: researchContentHash(content),
    candidateMatch: args.hit.candidateMatch,
    disposition: "rejected",
    supportedValuePaths: [],
    verifierReason: null,
  };
}
