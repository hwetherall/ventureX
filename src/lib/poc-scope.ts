/**
 * Deliberately small proof-of-concept scope.
 *
 * These limits are enforced at the prompt, schema, search, and UI layers so
 * a PoC click cannot silently expand into a production-sized research bill.
 */
export const POC_CANDIDATE_COUNT = 3;
export const POC_PARAMETER_COUNT = 10;
export const POC_STAGE3_MAX_SEARCH_QUERIES = 3;
export const POC_STAGE3_RESULTS_PER_QUERY = 3;
export const POC_STAGE3_ESTIMATED_OUTPUT_TOKENS = 1_000;
export const POC_STAGE3_MAX_OUTPUT_TOKENS = 1_500;

export const POC_CANDIDATE_SCOPE =
  `Return exactly ${POC_CANDIDATE_COUNT} candidates: ` +
  "exactly one Direct candidate, exactly one Category candidate, and " +
  "exactly one Same-Problem-Different-Mechanism candidate. Select the " +
  "single strongest, most decision-useful company in each category. Do not " +
  "return alternates, honorable mentions, or a longer discovery list.";

type ResearchParameterTier = "universal" | "framework" | "dynamic";

const POC_PARAMETER_TIER_QUOTAS: ReadonlyArray<{
  tier: ResearchParameterTier;
  count: number;
}> = [
  { tier: "universal", count: 3 },
  { tier: "framework", count: 4 },
  { tier: "dynamic", count: 3 },
];

/**
 * Select the paid-research subset for the 3×10 PoC. Sampling evenly within
 * each tier prevents the ten cells from being merely the first or easiest
 * fields in the full schema.
 */
export function selectPocResearchParameters<
  T extends { tier: ResearchParameterTier },
>(parameters: T[]): T[] {
  const selected: T[] = [];
  for (const quota of POC_PARAMETER_TIER_QUOTAS) {
    selected.push(
      ...takeEvenly(
        parameters.filter((parameter) => parameter.tier === quota.tier),
        quota.count,
      ),
    );
  }

  if (selected.length < POC_PARAMETER_COUNT) {
    const used = new Set(selected);
    selected.push(
      ...parameters
        .filter((parameter) => !used.has(parameter))
        .slice(0, POC_PARAMETER_COUNT - selected.length),
    );
  }

  return selected.slice(0, POC_PARAMETER_COUNT);
}

function takeEvenly<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[Math.floor((items.length - 1) / 2)]!];

  const indexes = new Set<number>();
  for (let index = 0; index < count; index++) {
    indexes.add(Math.round((index * (items.length - 1)) / (count - 1)));
  }
  return [...indexes].map((index) => items[index]!);
}
