import { ResearchProviderError } from "../../errors";
import type {
  CandidateIdentity,
  OfficialDataProvider,
  OfficialFact,
  OfficialLookupRequest,
} from "../../types";
import { sanitizeResearchText } from "../../utils";

const COMPANIES_HOUSE_URL =
  "https://api.company-information.service.gov.uk";

interface SearchPayload {
  items?: Array<{
    company_number?: string;
    title?: string;
    company_status?: string;
    address_snippet?: string;
    date_of_creation?: string;
  }>;
}

export class CompaniesHouseProvider implements OfficialDataProvider {
  readonly name = "companies_house" as const;

  supports(parameterKey: string, candidate: CandidateIdentity): boolean {
    return (
      parameterKey === "legal_name" &&
      (candidate.countryCode?.toUpperCase() === "GB" ||
        Boolean(candidate.companiesHouseNumber))
    );
  }

  async lookup(request: OfficialLookupRequest): Promise<OfficialFact[]> {
    if (!this.supports(request.parameterKey, request.candidate)) return [];
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      throw new ResearchProviderError(
        this.name,
        "COMPANIES_HOUSE_API_KEY not configured",
      );
    }
    const endpoint = request.candidate.companiesHouseNumber
      ? `${COMPANIES_HOUSE_URL}/company/${encodeURIComponent(request.candidate.companiesHouseNumber)}`
      : `${COMPANIES_HOUSE_URL}/search/companies?q=${encodeURIComponent(request.candidate.legalName ?? request.candidate.name)}&items_per_page=10`;
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ResearchProviderError(
          this.name,
          `Companies House returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
      }
      const payload = (await response.json()) as SearchPayload & {
        company_name?: string;
        company_number?: string;
        company_status?: string;
        registered_office_address?: Record<string, string>;
      };
      const direct = payload.company_name
        ? {
            title: payload.company_name,
            company_number: payload.company_number,
            company_status: payload.company_status,
            address_snippet: Object.values(
              payload.registered_office_address ?? {},
            ).join(", "),
          }
        : undefined;
      const row = direct ?? chooseCompany(payload.items ?? [], request.candidate);
      if (!row?.title || !row.company_number) return [];
      const title = sanitizeResearchText(row.title, 500);
      return [
        {
          provider: this.name,
          providerRequestId: response.headers.get("x-request-id"),
          parameterKey: request.parameterKey,
          value: title,
          url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(row.company_number)}`,
          title: `Companies House — ${title}`,
          excerpt: `${title}, company number ${row.company_number}, status ${row.company_status ?? "not stated"}${row.address_snippet ? `, registered address ${row.address_snippet}` : ""}.`,
          effectiveAt: request.asOf,
          sourceClass: "official_registry",
          costUsd: 0,
          latencyMs: Date.now() - started,
        },
      ];
    } catch (error) {
      if (error instanceof ResearchProviderError) throw error;
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Companies House timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ResearchProviderError(this.name, message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function chooseCompany<T extends { title?: string }>(
  items: T[],
  candidate: CandidateIdentity,
): T | undefined {
  const names = [candidate.name, candidate.legalName, ...candidate.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normalizeName);
  return (
    items.find((item) =>
      item.title ? names.includes(normalizeName(item.title)) : false,
    ) ?? items[0]
  );
}

function normalizeName(value: string): string {
  return value.replace(/[^a-z0-9]+/giu, " ").trim().toLowerCase();
}
