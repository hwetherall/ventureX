import { ResearchProviderError } from "../../errors";
import type {
  CandidateIdentity,
  OfficialDataProvider,
  OfficialFact,
  OfficialLookupRequest,
} from "../../types";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_DATA_URL = "https://data.sec.gov";

interface TickerRecord {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SubmissionsPayload {
  cik?: string;
  entityType?: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

interface CompanyFactsPayload {
  cik?: number;
  entityName?: string;
  facts?: Record<
    string,
    Record<
      string,
      {
        label?: string;
        description?: string;
        units?: Record<
          string,
          Array<{
            val?: number;
            start?: string;
            end?: string;
            filed?: string;
            form?: string;
            fy?: number;
            fp?: string;
            frame?: string;
            accn?: string;
          }>
        >;
      }
    >
  >;
}

let tickersCache: Promise<TickerRecord[]> | null = null;

export class SecEdgarProvider implements OfficialDataProvider {
  readonly name = "sec_edgar" as const;

  supports(parameterKey: string, candidate: CandidateIdentity): boolean {
    return (
      ["legal_name", "headcount", "latest_material_event", "rd_capacity"].includes(
        parameterKey,
      ) &&
      (!candidate.countryCode ||
        candidate.countryCode.toUpperCase() === "US" ||
        Boolean(candidate.cik))
    );
  }

  async lookup(request: OfficialLookupRequest): Promise<OfficialFact[]> {
    if (!this.supports(request.parameterKey, request.candidate)) return [];
    const userAgent = process.env.SEC_USER_AGENT;
    if (!userAgent || /<operations-email>/u.test(userAgent)) {
      throw new ResearchProviderError(
        this.name,
        "SEC_USER_AGENT must identify VentureX and a real contact address",
      );
    }
    const started = Date.now();
    const cik =
      request.candidate.cik ??
      (await resolveCik(request.candidate, userAgent, request.timeoutMs));
    if (!cik) return [];
    const padded = cik.padStart(10, "0");

    if (request.parameterKey === "legal_name") {
      const submissions = await secJson<SubmissionsPayload>(
        `${SEC_DATA_URL}/submissions/CIK${padded}.json`,
        userAgent,
        request.timeoutMs,
      );
      if (!submissions.payload.name) return [];
      return [
        fact({
          parameterKey: request.parameterKey,
          value: submissions.payload.name,
          url: `${SEC_DATA_URL}/submissions/CIK${padded}.json`,
          title: `SEC submissions — ${submissions.payload.name}`,
          excerpt: `${submissions.payload.name} is the registrant name for CIK ${padded}.`,
          effectiveAt: request.asOf,
          latencyMs: Date.now() - started,
          requestId: submissions.requestId,
          sourceClass: "official_filing",
        }),
      ];
    }

    if (request.parameterKey === "latest_material_event") {
      const submissions = await secJson<SubmissionsPayload>(
        `${SEC_DATA_URL}/submissions/CIK${padded}.json`,
        userAgent,
        request.timeoutMs,
      );
      const event = latestMaterialFiling(submissions.payload, request.asOf);
      if (!event) return [];
      const accession = event.accession.replace(/-/gu, "");
      const cikNumber = String(Number.parseInt(padded, 10));
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accession}/${event.document}`;
      const description = `${event.form} filing${event.description ? ` — ${event.description}` : ""}`;
      return [
        fact({
          parameterKey: request.parameterKey,
          value: { description, date: event.date },
          url: filingUrl,
          title: `${event.form} — ${submissions.payload.name ?? request.candidate.name}`,
          excerpt: `${submissions.payload.name ?? request.candidate.name} filed ${event.form} on ${event.date}${event.description ? `: ${event.description}` : "."}`,
          publishedAt: event.date,
          effectiveAt: event.date,
          latencyMs: Date.now() - started,
          requestId: submissions.requestId,
          sourceClass: "official_filing",
        }),
      ];
    }

    const companyFacts = await secJson<CompanyFactsPayload>(
      `${SEC_DATA_URL}/api/xbrl/companyfacts/CIK${padded}.json`,
      userAgent,
      request.timeoutMs,
    );
    if (request.parameterKey === "headcount") {
      const latest = latestFact(
        companyFacts.payload.facts?.dei?.EntityNumberOfEmployees,
      );
      if (!latest?.val || !latest.end) return [];
      return [
        fact({
          parameterKey: request.parameterKey,
          value: { value: latest.val, as_of: latest.end },
          url: companyFactSourceUrl(padded, latest.accn),
          title: `SEC employee disclosure — ${companyFacts.payload.entityName ?? request.candidate.name}`,
          excerpt: `${companyFacts.payload.entityName ?? request.candidate.name} reported ${latest.val.toLocaleString("en-US")} employees as of ${latest.end} in ${latest.form ?? "an SEC filing"}.`,
          publishedAt: latest.filed,
          effectiveAt: latest.end,
          latencyMs: Date.now() - started,
          requestId: companyFacts.requestId,
          sourceClass: "official_filing",
        }),
      ];
    }

    const latest = latestFact(
      companyFacts.payload.facts?.["us-gaap"]?.ResearchAndDevelopmentExpense,
      "USD",
    );
    if (!latest?.val || !latest.end) return [];
    return [
      fact({
        parameterKey: request.parameterKey,
        value: {
          spend: latest.val,
          currency: "USD",
          as_of: latest.end,
          fiscal_year: latest.fy ?? null,
        },
        url: companyFactSourceUrl(padded, latest.accn),
        title: `SEC R&D disclosure — ${companyFacts.payload.entityName ?? request.candidate.name}`,
        excerpt: `${companyFacts.payload.entityName ?? request.candidate.name} reported research and development expense of $${latest.val.toLocaleString("en-US")} for the period ending ${latest.end}.`,
        publishedAt: latest.filed,
        effectiveAt: latest.end,
        latencyMs: Date.now() - started,
        requestId: companyFacts.requestId,
        sourceClass: "official_filing",
      }),
    ];
  }
}

async function resolveCik(
  candidate: CandidateIdentity,
  userAgent: string,
  timeoutMs?: number,
): Promise<string | null> {
  tickersCache ??= secJson<Record<string, TickerRecord>>(
    SEC_TICKERS_URL,
    userAgent,
    timeoutMs,
  ).then(({ payload }) => Object.values(payload));
  const rows = await tickersCache;
  const names = [candidate.name, candidate.legalName, ...candidate.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normalizeCompanyName);
  const row = rows.find((entry) =>
    names.includes(normalizeCompanyName(entry.title)),
  );
  return row ? String(row.cik_str) : null;
}

async function secJson<T>(
  url: string,
  userAgent: string,
  timeoutMs = 20_000,
): Promise<{ payload: T; requestId: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ResearchProviderError(
        "sec_edgar",
        `SEC returned ${response.status}: ${body.slice(0, 300)}`,
        response.status,
      );
    }
    return {
      payload: (await response.json()) as T,
      requestId: response.headers.get("x-request-id"),
    };
  } catch (error) {
    if (error instanceof ResearchProviderError) throw error;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `SEC timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ResearchProviderError("sec_edgar", message, undefined, error);
  } finally {
    clearTimeout(timeout);
  }
}

function latestMaterialFiling(payload: SubmissionsPayload, asOf: string) {
  const recent = payload.filings?.recent;
  const forms = recent?.form ?? [];
  const asOfMs = Date.parse(asOf);
  const minMs = asOfMs - 365 * 24 * 60 * 60 * 1000;
  for (let index = 0; index < forms.length; index++) {
    const form = forms[index];
    const date = recent?.filingDate?.[index];
    const accession = recent?.accessionNumber?.[index];
    const document = recent?.primaryDocument?.[index];
    if (!form || !date || !accession || !document) continue;
    const dateMs = Date.parse(date);
    if (dateMs < minMs || dateMs > asOfMs) continue;
    if (!["8-K", "8-K/A", "6-K", "6-K/A"].includes(form)) continue;
    return {
      form,
      date,
      accession,
      document,
      description: recent?.primaryDocDescription?.[index] ?? "",
    };
  }
  return null;
}

function latestFact(
  concept:
    | {
        units?: Record<
          string,
          Array<{
            val?: number;
            end?: string;
            filed?: string;
            form?: string;
            fy?: number;
            accn?: string;
          }>
        >;
      }
    | undefined,
  preferredUnit?: string,
) {
  const units = concept?.units;
  if (!units) return null;
  const entries = preferredUnit
    ? (units[preferredUnit] ?? [])
    : Object.values(units).flat();
  return (
    entries
      .filter(
        (entry) =>
          typeof entry.val === "number" &&
          Boolean(entry.end) &&
          ["10-K", "20-F", "40-F"].includes(entry.form ?? ""),
      )
      .sort((a, b) =>
        `${b.filed ?? ""}-${b.end ?? ""}`.localeCompare(
          `${a.filed ?? ""}-${a.end ?? ""}`,
        ),
      )[0] ?? null
  );
}

function companyFactSourceUrl(cik: string, accession?: string): string {
  if (!accession) {
    return `${SEC_DATA_URL}/api/xbrl/companyfacts/CIK${cik}.json`;
  }
  const accessionPlain = accession.replace(/-/gu, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number.parseInt(cik, 10)}/${accessionPlain}/`;
}

function fact(args: {
  parameterKey: string;
  value: unknown;
  url: string;
  title: string;
  excerpt: string;
  publishedAt?: string;
  effectiveAt?: string;
  latencyMs: number;
  requestId: string | null;
  sourceClass: "official_filing" | "official_registry";
}): OfficialFact {
  return {
    provider: "sec_edgar",
    providerRequestId: args.requestId,
    parameterKey: args.parameterKey,
    value: args.value,
    url: args.url,
    title: args.title,
    excerpt: args.excerpt,
    publishedAt: args.publishedAt ?? null,
    effectiveAt: args.effectiveAt ?? null,
    sourceClass: args.sourceClass,
    costUsd: 0,
    latencyMs: args.latencyMs,
  };
}

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|plc|limited|ltd|holdings?)\b/giu, " ")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}
