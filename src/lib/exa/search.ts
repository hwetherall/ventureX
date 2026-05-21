import { ExaError } from "./errors";
import { broadenTier3Query } from "./query";

/**
 * Strip UTF-16 lone surrogate code units, replacing each with U+FFFD.
 *
 * Why: Exa occasionally returns snippets scraped from PDFs and other lossy
 * sources containing unpaired surrogate halves (e.g. a leading 0xD8xx with
 * no trailing 0xDCxx). JavaScript stores these as-is. Downstream,
 * `JSON.stringify` of such a string emits a literal `\uD8xx` escape which
 * is technically valid JSON but invalid Unicode — and Postgres's JSONB
 * parser rejects it with "unsupported Unicode escape sequence". That kills
 * subsequent INSERTs (most painfully, the `llm_call_logs` placeholder
 * insert inside `callLLM`, which aborts a tier before the model call runs).
 *
 * INBRAIN Neuroelectronics' M16 backfill (2026-05-21) hit this: one T2
 * pre-search result carried a lone surrogate, the orchestrator's
 * `logExaCall` silently dropped the row, and the subsequent T2 placeholder
 * insert blew up. Sanitising at the Exa boundary fixes both call sites.
 */
function sanitizeForJson(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "�",
  );
}

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
  /**
   * Optional server-side text filter (Exa `includeText` parameter). When
   * set, Exa only returns results whose page text contains the supplied
   * phrase.
   *
   * Used by Tier 3 cell research (M15-F1) to anchor neural search on the
   * candidate's name — without it, queries like "Schneider Electric rack
   * power shelf" return Vertiv/Eaton/Advanced Energy product pages because
   * neural search matches the topic. With `includeText: 'Schneider
   * Electric'`, Exa filters to results actually about Schneider.
   *
   * Implementation note: Exa's API requires `includeText` to be a
   * single-element array of strings, not a bare string. The caller passes a
   * single phrase here for ergonomics; the wrapper wraps it in an array
   * before sending. Discovered the hard way 2026-05-20 — passing a string
   * produces HTTP 400 with "expected array, received string".
   */
  includeText?: string;
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
        // M15-F1: server-side anchor on candidate name. Omitted when not set
        // so non-Stage-5 callers (e.g., M13 brainstorming) keep their current
        // unfiltered behavior. Exa requires this as a single-element array
        // of strings — bare string returns HTTP 400.
        ...(args.includeText ? { includeText: [args.includeText] } : {}),
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
      title: sanitizeForJson(r.title ?? ""),
      text: sanitizeForJson(r.text ?? ""),
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

/**
 * @public
 * Result of {@link exaSearchWithBroadenRetry}. Reports both attempts so the
 * orchestrator can log the broadening event and the caller knows whether
 * the final hit set came from the original or broadened query.
 */
export interface ExaBroadenedSearchResponse {
  /** The successful response, or null when both attempts returned empty. */
  response: ExaSearchResponse | null;
  /** First-attempt response (always populated unless the call threw). */
  initial: ExaSearchResponse;
  /** Second-attempt response (populated only when the broadened retry fired). */
  broadened: ExaSearchResponse | null;
  /** True when the orchestrator should record `confidence='unknown'`. */
  isEmpty: boolean;
  /** The broadened query string, if a retry fired. */
  broadenedQuery: string | null;
}

/**
 * @public
 * M15 Tier 3 fallback chain (design doc §Tier 3 fallback chain). Runs one
 * Exa search; if `results` is empty, broadens the query (drops the
 * most-specific trailing token via {@link broadenTier3Query}) and retries
 * once. Still empty → caller writes the cell as `confidence='unknown'`
 * with `reason='no_evidence_found'`.
 *
 * **Never** falls through to Opus / training data for the cell value —
 * Tier 3 exists specifically for facts that need fresh evidence, so
 * bypassing the search defeats the architecture (M15_DESIGN.md line 130).
 */
export async function exaSearchWithBroadenRetry(
  args: ExaSearchArgs,
): Promise<ExaBroadenedSearchResponse> {
  const initial = await exaSearch(args);
  if (initial.results.length > 0) {
    return {
      response: initial,
      initial,
      broadened: null,
      isEmpty: false,
      broadenedQuery: null,
    };
  }

  const broadenedQuery = broadenTier3Query(args.query);
  if (broadenedQuery === null) {
    return {
      response: null,
      initial,
      broadened: null,
      isEmpty: true,
      broadenedQuery: null,
    };
  }

  const broadened = await exaSearch({ ...args, query: broadenedQuery });
  return {
    response: broadened.results.length > 0 ? broadened : null,
    initial,
    broadened,
    isEmpty: broadened.results.length === 0,
    broadenedQuery,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
