/**
 * Tier 3 Exa query construction + broadening retry (M15).
 *
 * Each Tier 3 cell pairs a `prompt_hint` (from the parameter schema) with a
 * candidate name to produce a single neural search query. If the first
 * search returns empty results, the orchestrator retries ONCE with a
 * broadened query that drops the most-specific keyword from the prompt
 * hint. Still empty → cell is stored as `confidence='unknown'` with
 * `reason='no_evidence_found'` (design doc §Tier 3 fallback chain).
 *
 * Worked example (resolves M15_DESIGN.md §Reviewer Concerns row 3):
 *
 *   buildTier3Query("Find the latest product announcement in rack PDU.", "Schneider Electric")
 *     → "Schneider Electric latest product announcement rack PDU"
 *
 *   broadenTier3Query("Schneider Electric latest product announcement rack PDU")
 *     → "Schneider Electric latest product announcement"   // drops the trailing
 *                                                            // domain-specific token
 *
 * The function is pure — no Exa call, no I/O — so it's trivial to unit-test
 * deterministically. The orchestrator wires `exaSearch` around it.
 */

/**
 * @public
 * Build a Tier 3 Exa search query from a parameter's prompt_hint and the
 * candidate name. Templated rather than free-form natural language so the
 * query shape is deterministic and reproducible.
 *
 * Steps:
 *   1. Strip the prompt_hint of common instructional preambles ("Find the",
 *      "Identify", "Determine", etc.) so the query reads as a noun phrase.
 *   2. Strip terminal punctuation.
 *   3. Concatenate `<candidate name> <stripped hint>`.
 *   4. Collapse whitespace.
 */
export function buildTier3Query(
  promptHint: string,
  candidateName: string,
): string {
  // Collapse whitespace first so the instructional-preamble patterns match
  // even when the hint has irregular spacing.
  const normalised = collapseWhitespace(promptHint);
  const stripped = stripInstructionalPreamble(normalised);
  const cleaned = stripped.replace(/[.!?,;:]+$/u, "").trim();
  // Drop a leading stopword if the strip exposed one (e.g. "Find the X" → "the X" → "X").
  const denuded = stripLeadingStopword(cleaned);
  return collapseWhitespace(`${candidateName} ${denuded}`);
}

/**
 * Internal: drop one leading stopword if present. Used to clean up cases
 * where the instructional preamble strip exposed a leading "the" / "a" /
 * "an" that would otherwise sit awkwardly at the start of the query.
 */
function stripLeadingStopword(s: string): string {
  const tokens = s.split(/\s+/u);
  if (tokens.length > 1 && isStopword(tokens[0]!)) {
    return tokens.slice(1).join(" ");
  }
  return s;
}

/**
 * @public
 * Broaden a Tier 3 query by dropping the most-specific token — heuristically
 * the trailing token, which carries the most narrowing weight in neural
 * search ranking. A neural search for "Schneider Electric latest product
 * announcement rack PDU" is more specific than "Schneider Electric latest
 * product announcement" — the broader form tends to surface adjacent
 * evidence that the narrower form filtered out.
 *
 * Returns null when the query has 3 or fewer tokens — broadening below
 * `<candidate name>` + 1 noun produces too-wide queries that hurt more
 * than help. The orchestrator interprets null as "skip retry, write
 * confidence='unknown' directly."
 *
 * Implementation detail: we drop trailing stopwords first (a, the, and, of,
 * for, in, on, with) before dropping the last meaningful token. Otherwise
 * "rack PDU vendor" → "rack PDU" → "rack" feels right, but
 * "Schneider founded in" → "Schneider founded" → "Schneider" is too steep.
 */
export function broadenTier3Query(query: string): string | null {
  const tokens = collapseWhitespace(query).split(" ").filter(Boolean);
  // Input floor: ≤3 tokens is already minimal (`<candidate> + 1-2 words`).
  // Broadening below that point is too wide to help.
  if (tokens.length <= 3) return null;

  let working = [...tokens];

  // First trim trailing stopwords so we drop a content token next.
  while (working.length > 2 && isStopword(working[working.length - 1]!)) {
    working = working.slice(0, -1);
  }

  // Drop the last meaningful token.
  if (working.length <= 2) return null;
  working = working.slice(0, -1);

  // Re-trim trailing stopwords now exposed.
  while (working.length > 2 && isStopword(working[working.length - 1]!)) {
    working = working.slice(0, -1);
  }

  // Output floor: need at least <candidate> + 1 token so the query stays
  // grounded in the candidate's identity.
  if (working.length < 2) return null;

  const broadened = working.join(" ");
  // Avoid the no-op case where every step was a stopword strip on a
  // already-minimal query.
  if (broadened === query) return null;
  return broadened;
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers (exported for tests only)
// ──────────────────────────────────────────────────────────────────────────

const INSTRUCTIONAL_PREAMBLE_PATTERNS = [
  /^find (the )?/iu,
  /^identify (the )?/iu,
  /^determine (the |whether )?/iu,
  /^classify (the )?/iu,
  /^capture (the )?/iu,
  /^list (the |any )?/iu,
  /^summarize (the )?/iu,
  /^if (the )?/iu, // "If public, provide ticker..." — strip and keep the rest
  /^use (the )?/iu,
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "in",
  "on",
  "at",
  "to",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "be",
  "company's",
  "company",
]);

/**
 * Internal: strip leading instructional verbs from a prompt_hint so the
 * remainder reads as a noun phrase good for neural search. Idempotent.
 */
export function stripInstructionalPreamble(hint: string): string {
  let current = hint.trim();
  for (const pattern of INSTRUCTIONAL_PREAMBLE_PATTERNS) {
    const next = current.replace(pattern, "");
    if (next !== current) {
      current = next.trimStart();
      // Capitalize first char isn't necessary — Exa neural search is
      // case-insensitive. Lowercasing the first letter doesn't help either.
      break;
    }
  }
  return current;
}

/** Internal: collapse runs of whitespace into single spaces. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

/** Internal: stopword check used by the broadening trim. */
export function isStopword(token: string): boolean {
  return STOPWORDS.has(token.toLowerCase());
}
