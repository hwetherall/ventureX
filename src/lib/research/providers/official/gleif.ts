import { ResearchProviderError } from "../../errors";
import type {
  CandidateIdentity,
  OfficialDataProvider,
  OfficialFact,
  OfficialLookupRequest,
} from "../../types";
import { sanitizeResearchText } from "../../utils";

const GLEIF_URL = "https://api.gleif.org/api/v1/lei-records";

interface GleifRecord {
  id?: string;
  attributes?: {
    lei?: string;
    entity?: {
      legalName?: { name?: string };
      legalAddress?: { country?: string };
      headquartersAddress?: { country?: string };
      status?: string;
    };
  };
}

interface GleifPayload {
  data?: GleifRecord[] | GleifRecord;
}

export class GleifProvider implements OfficialDataProvider {
  readonly name = "gleif" as const;

  supports(parameterKey: string, _candidate: CandidateIdentity): boolean {
    return parameterKey === "legal_name";
  }

  async lookup(request: OfficialLookupRequest): Promise<OfficialFact[]> {
    if (!this.supports(request.parameterKey, request.candidate)) return [];
    const endpoint = request.candidate.lei
      ? `${GLEIF_URL}/${encodeURIComponent(request.candidate.lei)}`
      : `${GLEIF_URL}?filter[entity.legalName]=${encodeURIComponent(request.candidate.legalName ?? request.candidate.name)}&page[size]=5`;
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/vnd.api+json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ResearchProviderError(
          this.name,
          `GLEIF returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
      }
      const payload = (await response.json()) as GleifPayload;
      const rows = Array.isArray(payload.data)
        ? payload.data
        : payload.data
          ? [payload.data]
          : [];
      const record = chooseRecord(rows, request.candidate);
      const legalName = record?.attributes?.entity?.legalName?.name;
      const lei = record?.attributes?.lei ?? record?.id;
      if (!record || !legalName || !lei) return [];
      const country =
        record.attributes?.entity?.headquartersAddress?.country ??
        record.attributes?.entity?.legalAddress?.country ??
        "unknown country";
      return [
        {
          provider: this.name,
          providerRequestId: response.headers.get("x-request-id"),
          parameterKey: request.parameterKey,
          value: sanitizeResearchText(legalName, 500),
          url: `${GLEIF_URL}/${encodeURIComponent(lei)}`,
          title: `GLEIF LEI record — ${legalName}`,
          excerpt: `${legalName} is the legal entity name in LEI record ${lei}; headquarters/legal country: ${country}.`,
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
          ? `GLEIF timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ResearchProviderError(this.name, message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function chooseRecord(
  rows: GleifRecord[],
  candidate: CandidateIdentity,
): GleifRecord | undefined {
  const names = [candidate.name, candidate.legalName, ...candidate.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normalizeName);
  return (
    rows.find((row) => {
      const legal = row.attributes?.entity?.legalName?.name;
      return legal ? names.includes(normalizeName(legal)) : false;
    }) ?? rows[0]
  );
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}
