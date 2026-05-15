import { ExaError } from "./errors";

/**
 * Exa neural search wrapper (M13).
 *
 * Used by the Stage 3 orchestrator to ground candidate brainstorm in real web
 * evidence: for each `strategic_risks_and_uncertainties[].implies_search_for`
 * string, we run one neural search and bundle the results into the Opus
 * prompt as a "## Web evidence" block. See PHASE3.md §6b for the contract.
 *
 * Why neural mode (P3-D9): semantic matching is the right ranking primitive
 * for "companies that ship X" queries. Keyword search returns SEO-optimized
 * landing pages; neural search returns the actual vendors.
 */

const EXA_SEARCH_URL = "https://api.exa.ai/search";

// Per-call default timeout. Exa typically responds in 500-2000ms; 15s leaves
// headroom for cold-cache neural queries. The orchestrator runs 6 searches
// in parallel so the per-call budget is what gates the web phase, not the
// sum of all six.
const DEFAULT_TIMEOUT_MS = 15_000;

// Per-query result count. The Opus prompt currently has ~150k tokens of
// context headroom (input is ~11k; budget is ~200k). 6 queries × 6 results
// × ~1000-char text snippets = ~36k tokens of evidence — comfortable.
// Setting this above 8 starts to crowd the prompt without proportionally
// improving candidate coverage.
const DEFAULT_NUM_RESULTS = 6;

// Per-result snippet character cap. Exa's `contents.text = true` returns the
// full page text by default — typically 5-10k chars on product / vendor
// pages, which would explode prompt size at 6 queries × 6 results. Capping
// at 1000 chars gives the model a paragraph of context per hit (enough to
// confirm relevance) while keeping the evidence block under ~36k chars.
const DEFAULT_MAX_CHARS_PER_RESULT = 1000;

/**
 * @public
 * Single hit from an Exa search. Field names match Exa's wire format so the
 * orchestrator can pass results straight through without renaming dance.
 */
export interface ExaSearchResult {
  url: string;
  title: string;
  text: string;
  score?: number;
  publishedDate?: string;
}

/**
 * @public
 * Result of one search call.
 */
export interface ExaSearchResponse {
  /** The exact query string that was sent. Echoed for trace + citation linkage. */
  query: string;
  results: ExaSearchResult[];
  latencyMs: number;
}

/**
 * @public
 * Arguments for {@link exaSearch}.
 */
export interface ExaSearchArgs {
  query: string;
  /**
   * 1-25. Defaults to 6. Higher counts grow the prompt linearly and the
   * orchestrator concatenates results across 6 queries, so keep this modest.
   */
  numResults?: number;
  /**
   * Search ranking mode. `neural` is the M13 default; `keyword` is the
   * traditional inverted-index match; `auto` lets Exa pick based on the
   * query shape. PHASE3.md P3-D9 calls for `neural` and the orchestrator
   * does not override.
   */
  type?: "neural" | "keyword" | "auto";
  /**
   * Per-call timeout in ms. Defaults to 15_000.
   */
  timeoutMs?: number;
  /**
   * Per-result `text` cap, in characters. Defaults to 1000 — see the
   * `DEFAULT_MAX_CHARS_PER_RESULT` rationale at module top. Pass a larger
   * value when you genuinely need long-form content (rare for our use).
   */
  maxCharactersPerResult?: number;
}

interface ExaApiResult {
  url: string;
  title?: string;
  text?: string;
  score?: number;
  publishedDate?: string;
}

interface ExaApiResponse {
  results?: ExaApiResult[];
}

/**
 * @public
 * Run one Exa neural search. Throws {@link ExaError} on any failure mode:
 *   - `EXA_API_KEY` not set in environment
 *   - network error / fetch failure
 *   - non-2xx HTTP response
 *   - timeout (default 15s, configurable)
 *   - response payload missing the expected `results` array
 *
 * Successful results are normalized: missing `title` becomes the empty
 * string, missing `text` becomes the empty string. Downstream code can
 * filter empty-text hits if needed; this layer does not lose the URL.
 */
export async function exaSearch(args: ExaSearchArgs): Promise<ExaSearchResponse> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new ExaError("EXA_API_KEY not set in environment");
  }

  const numResults = args.numResults ?? DEFAULT_NUM_RESULTS;
  const type = args.type ?? "neural";
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCharacters =
    args.maxCharactersPerResult ?? DEFAULT_MAX_CHARS_PER_RESULT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: args.query,
        type,
        numResults,
        // `contents.text.maxCharacters` caps the per-result text payload at
        // the source — avoids transferring 10k-char page dumps when ~1000
        // chars of snippet is all the prompt needs.
        contents: { text: { maxCharacters: maxCharacters } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ExaError(
        `Exa returned ${res.status}: ${body.slice(0, 500)}`,
        res.status,
      );
    }

    const payload = (await res.json()) as ExaApiResponse;
    if (!payload.results || !Array.isArray(payload.results)) {
      throw new ExaError(
        "Exa response missing `results` array",
        res.status,
        payload,
      );
    }

    const results: ExaSearchResult[] = payload.results.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      text: r.text ?? "",
      ...(r.score !== undefined && { score: r.score }),
      ...(r.publishedDate !== undefined && { publishedDate: r.publishedDate }),
    }));

    return {
      query: args.query,
      results,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    if (err instanceof ExaError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ExaError(`Exa call timed out after ${timeoutMs}ms`);
    }
    throw new ExaError(
      `Exa call failed: ${stringifyError(err)}`,
      undefined,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @public
 * Run multiple Exa searches in parallel. Convenience wrapper around
 * {@link exaSearch} — the orchestrator could `Promise.all` itself, but
 * batching here gives us a place to add cross-call rate-limiting or
 * shared-cache lookups in M14+ without touching call sites.
 *
 * Failures bubble up: if any one search throws, the whole batch rejects.
 * The orchestrator's outer try-catch handles this by stamping
 * `status='error'` and surfacing the message to the user.
 */
export async function exaSearchBatch(
  queries: string[],
  options?: Omit<ExaSearchArgs, "query">,
): Promise<ExaSearchResponse[]> {
  return Promise.all(
    queries.map((query) => exaSearch({ ...options, query })),
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
