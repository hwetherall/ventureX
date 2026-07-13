import { BraveSearchProvider } from "@/lib/research/providers/brave";
import { BrightDataContentProvider } from "@/lib/research/providers/bright-data";
import { ExaContentsProvider } from "@/lib/research/providers/exa-contents";
import { ExaSearchProvider } from "@/lib/research/providers/exa-search";
import { CompaniesHouseProvider } from "@/lib/research/providers/official/companies-house";
import { GleifProvider } from "@/lib/research/providers/official/gleif";
import { SecEdgarProvider } from "@/lib/research/providers/official/sec-edgar";
import type { CandidateIdentity } from "@/lib/research/types";

interface SmokeResult {
  provider: string;
  operation: string;
  ok: boolean;
  latencyMs: number;
  resultCount?: number;
  error?: string;
}

const asOf = new Date().toISOString().slice(0, 10);

const vertiv: CandidateIdentity = {
  candidateId: "provider-smoke-vertiv",
  name: "Vertiv",
  legalName: "Vertiv Holdings Co",
  aliases: ["Vertiv Holdings"],
  domains: ["vertiv.com"],
  countryCode: "US",
};

const rioTinto: CandidateIdentity = {
  candidateId: "provider-smoke-rio-tinto",
  name: "Rio Tinto",
  legalName: "Rio Tinto plc",
  aliases: [],
  domains: ["riotinto.com"],
  countryCode: "GB",
};

async function smoke(
  provider: string,
  operation: string,
  run: () => Promise<number | undefined>,
): Promise<SmokeResult> {
  const started = Date.now();
  try {
    const resultCount = await run();
    return {
      provider,
      operation,
      ok: true,
      latencyMs: Date.now() - started,
      ...(resultCount === undefined ? {} : { resultCount }),
    };
  } catch (error) {
    return {
      provider,
      operation,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = await Promise.all([
  smoke("exa", "search", async () => {
    const response = await new ExaSearchProvider().search({
      query: "Vertiv official company website",
      count: 1,
      timeoutMs: 20_000,
    });
    return response.hits.length;
  }),
  smoke("exa", "contents", async () => {
    const response = await new ExaContentsProvider().fetch({
      url: "https://www.vertiv.com/en-us/about/",
      maxCharacters: 2_000,
      timeoutMs: 30_000,
    });
    return response.content.length > 0 ? 1 : 0;
  }),
  smoke("brave", "search", async () => {
    const response = await new BraveSearchProvider().search({
      query: "Vertiv official company website",
      count: 1,
      timeoutMs: 20_000,
    });
    return response.hits.length;
  }),
  smoke("bright_data", "fetch", async () => {
    const response = await new BrightDataContentProvider().fetch({
      url: "https://example.com/",
      maxCharacters: 2_000,
      timeoutMs: 45_000,
    });
    return response.content.length > 0 ? 1 : 0;
  }),
  smoke("gleif", "legal_name", async () => {
    const facts = await new GleifProvider().lookup({
      candidate: vertiv,
      parameterKey: "legal_name",
      asOf,
      timeoutMs: 20_000,
    });
    return facts.length;
  }),
  smoke("sec_edgar", "legal_name", async () => {
    const facts = await new SecEdgarProvider().lookup({
      candidate: vertiv,
      parameterKey: "legal_name",
      asOf,
      timeoutMs: 25_000,
    });
    return facts.length;
  }),
  smoke("companies_house", "legal_name", async () => {
    const facts = await new CompaniesHouseProvider().lookup({
      candidate: rioTinto,
      parameterKey: "legal_name",
      asOf,
      timeoutMs: 20_000,
    });
    return facts.length;
  }),
]);

console.log(JSON.stringify(results, null, 2));

if (results.some((result) => !result.ok || result.resultCount === 0)) {
  process.exitCode = 1;
}
