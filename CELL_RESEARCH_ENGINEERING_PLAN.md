# Cell Research Improvement — Engineering Workstream

Status: implemented; ABB paired run complete; human adjudication pending  
Branch: `cell-improve`  
Service counterpart: `CELL_RESEARCH_SERVICE_SETUP.md`

## Objective

Build a second, evidence-first cell-research pipeline and compare it cheaply against the existing pipeline on the exact ABB **3 candidates × 10 parameters** case.

This milestone is about research quality only:

- Stage 6 scoring and ranking are complete and out of scope.
- Investor-report/PDF work remains deferred.
- Candidate selection and the ten selected parameters do not change during the comparison.
- The existing Stage 5 pipeline remains available as the baseline until the new approach wins on evidence.
- Perplexity is represented by a disabled extension point, not used in the first run.

## Product hypothesis

A parameter-routed pipeline will produce more reliable cells at similar cost because it applies the cheapest adequate research method to each fact:

- Stable identity facts use authoritative registries or filings.
- Current facts use date-bounded web/news discovery.
- Product facts use official documentation and full-page extraction.
- Relationships and deployments require exact semantic proof, often from both parties.
- Hard unresolved facts escalate through a bounded repair loop.
- Unknown remains a valid result when the evidence does not support a claim.

The comparison must test this hypothesis rather than merely producing a more verbose table.

## Why this is a V2 pipeline, not a patch to the prompts

The current Stage 5 architecture has four structural constraints:

1. `universal` parameters are researched from model training data.
2. `framework` parameters share a generic, candidate-level evidence pool.
3. `dynamic` parameters receive three Exa results and retry only when the result list is empty.
4. The extractor assigns its own confidence, while one cell stores only one citation.

Prompt changes alone cannot add authoritative source routing, multi-source evidence, independent verification, or reproducible A/B runs.

## Locked decisions

1. **Route by parameter policy, not by tier.** The existing tier remains useful for UI and sampling, but no longer determines the research method.
2. **Preserve the baseline.** Do not overwrite the existing ABB cells while creating the comparison.
3. **Evidence precedes value.** Search and extraction produce evidence records; the model may derive a value only from accepted evidence.
4. **Confidence is computed.** The extractor may propose direct/inferred support, but the verifier and policy determine the stored confidence.
5. **Multiple evidence records are allowed.** The canonical UI may initially show the best source, but storage cannot be limited to one citation.
6. **Research is bounded.** Every policy declares maximum attempts, providers, pages, cost, and elapsed time.
7. **Bright Data is a fallback fetcher.** It is not called when Exa Contents or ordinary retrieval already returns usable content.
8. **Perplexity is feature-flagged off.** No automatic big-gun escalation in this milestone.
9. **Promotion is explicit.** V2 results become canonical `cells` only after the comparison is accepted.

## Target architecture

```text
candidate + parameter
        │
        ▼
parameter ResearchPolicy
        │
        ├── official source adapter (when applicable)
        │
        └── Exa semantic search + Brave lexical/news search
                              │
                              ▼
                  dedupe, identity check, source ranking
                              │
                              ▼
              full content via Exa Contents / direct fetch
                              │
                     blocked or incomplete?
                              │ yes
                              ▼
                    Bright Data Web Unlocker
                              │
                              ▼
                     evidence extraction
                              │
                              ▼
                  independent claim verifier
                              │
              ┌───────────────┴────────────────┐
              │ pass                           │ reject/weak
              ▼                                ▼
        V2 cell result                 bounded repair query
                                               │
                                      still unsupported?
                                               ▼
                                             unknown
```

## Core domain model

### `ResearchPolicy`

Each parameter must declare a policy similar to:

```ts
interface ResearchPolicy {
  parameterKey: string;
  sourceRoutes: SourceRoute[];
  sourcePreference: SourceClass[];
  queryTemplates: string[];
  freshness?: { maxAgeDays?: number; dateWindow?: "rolling_12_months" };
  proofRule: string;
  inference: "forbidden" | "allowed" | "expected";
  minimumDirectSources: number;
  maximumAttempts: number;
  maximumSearches: number;
  maximumFetchedPages: number;
  maximumCostUsd: number;
  validateValue: (value: unknown) => ValidationResult;
  validateEvidence: (claim: Claim, evidence: Evidence[]) => ValidationResult;
}
```

The prose `proofRule` is supplied to the semantic verifier; code-level validators enforce dates, enums, required names, source classes, and value shapes.

### Evidence

Evidence storage must include:

- Provider and provider request ID.
- URL, title, source domain, and source class.
- Exact supporting excerpt.
- Publication/effective date when available.
- Retrieval timestamp.
- Search query and result rank.
- Candidate identity match.
- Which part of the proposed value the excerpt supports.
- Direct, inferred, contradictory, or rejected disposition.
- Verifier outcome and reason.

### Research attempts

Unknown cells still need an auditable trail. Store every bounded attempt with provider, query, filters, result count, error, latency, and cost. “Unknown” should mean “the declared research plan did not find acceptable proof,” not “the model did not remember an answer.”

## Proposed persistence model

The existing `cells` table is canonical and has `UNIQUE(candidate_id, parameter_key)`, so it cannot hold side-by-side baseline and V2 results. Add experiment-oriented tables rather than weakening canonical behavior:

### `cell_research_runs`

- `id`
- `venture_id`
- `pipeline_version` (`v1_snapshot`, `v2_policy_routed`)
- provider/config snapshot without secrets
- selected candidate IDs and parameter keys
- status
- predicted and actual cost
- start/end timestamps
- aggregate metrics

### `cell_research_results`

- `run_id`
- `candidate_id`
- `parameter_key`
- value
- proposed confidence
- final confidence
- reason
- verifier outcome
- total cost and latency
- unique `(run_id, candidate_id, parameter_key)`

### `cell_evidence`

- `result_id`
- provider/source metadata listed above
- excerpt
- disposition
- verifier reason

### `research_provider_calls`

Generalizes `exa_call_logs` for Exa, Brave, Bright Data, official APIs, and the disabled Perplexity provider. Secrets and authorization headers must never be persisted.

After acceptance, a promotion function copies one run’s accepted results into canonical `cells` so the existing table, scoring, CSV, and report surfaces continue to work.

## Provider adapters

Define provider-neutral contracts before implementing live services:

```ts
interface SearchProvider {
  search(request: SearchRequest): Promise<SearchResponse>;
}

interface ContentProvider {
  fetch(request: ContentRequest): Promise<ContentResponse>;
}

interface OfficialDataProvider {
  supports(policy: ResearchPolicy, company: CompanyIdentity): boolean;
  lookup(request: OfficialLookupRequest): Promise<OfficialLookupResponse>;
}

interface DeepResearchProvider {
  research(request: DeepResearchRequest): Promise<DeepResearchResponse>;
}
```

Initial adapters:

- `ExaSearchProvider`
- `ExaContentsProvider`
- `BraveSearchProvider`
- `BrightDataContentProvider`
- `SecEdgarProvider`
- `GleifProvider`
- `CompaniesHouseProvider`
- `PerplexityDeepResearchProvider` — compiled and tested with fixtures, but disabled at runtime

Adapters must normalize results into shared types. Provider-specific response shapes must not leak into policies or Stage 5 orchestration.

## Research policies for the ABB ten

These ten policies are the actual 0→1 deliverable.

| Parameter | Primary route | Secondary route | Proof required | Inference rule |
|---|---|---|---|---|
| `legal_name` | GLEIF, SEC, national registry | Official company legal/IR page | Exact registered entity name tied to the candidate identity | Forbidden |
| `headcount` | Latest filing/annual report or official company disclosure | Exa + Brave discovery of dated authoritative disclosure | Employee count and explicit as-of/fiscal date | Allowed only as a labelled third-party estimate; never “verified” |
| `latest_material_event` | Official press/IR and SEC recent filings | Brave news + Exa with strict 12-month window | Dated event within the rolling window and a reason it is material | Forbidden for the event/date; materiality explanation may be inferred |
| `core_offering` | Official product page/catalog/datasheet | Authoritative distributor or analyst documentation | Source explicitly describes the candidate’s relevant product/service | Forbidden for product existence; summary wording may be synthesized |
| `pricing_disclosure` | Official pricing/configurator/catalog, then authorized distributors | Exa + Brave site/domain searches | A published price/range, or a documented bounded search supporting “not publicly disclosed” | “Opaque” is inferred unless the company explicitly says quote/contact sales |
| `sales_cycle_length` | Official procurement, implementation, partner, or case-study material | Credible analyst/customer material | Explicit duration or dated milestones for the relevant sale/deployment | Expected; cannot be `verified` without explicit duration evidence |
| `rd_capacity` | Annual report/filing, official R&D locations, patents or R&D disclosure | Exa + Brave targeted searches | Actual R&D spend, named centers, R&D headcount, or relevant patent evidence | Manufacturing expansion alone is rejected |
| `busbar_tap_off_offering` | Official product catalog/datasheet | Authorized distributor documentation | Explicit busbar plus tap-off/tap box/tap unit product evidence | Forbidden for `yes_productized` |
| `server_oem_integrator_relationships` | Candidate and partner press/partner pages | Exa + Brave exact-pair searches | Named OEM/integrator and explicit commercial, integration, resale, bundle, or relevant deployment relationship | Forbidden for relationship existence |
| `hyperscaler_reference_wins` | Candidate/customer case study or press release | Exa + Brave named-customer searches | Named allowed customer and explicit use/deployment of the relevant product category | Forbidden; adjacent cooling, campus, or general partnership evidence is rejected |

Aliases must be first-class. Search using the legal entity, trading name, relevant product brand, acquired brands, and abbreviations, while the identity validator prevents cross-company contamination.

## Query and retrieval sequence

For one `(candidate, parameter)` pair:

1. Resolve company identity and aliases from the candidate plus official sources.
2. Execute the applicable official-source route.
3. Generate two to four parameter-specific queries from the policy.
4. Search Exa and Brave concurrently with explicit date/domain filters where applicable.
5. Merge and deduplicate canonical URLs.
6. Rank by candidate match, source class, freshness, and query relevance.
7. Fetch complete content for the best bounded set of pages.
8. Use Bright Data only for pages that are blocked, incomplete, or require rendering.
9. Extract candidate claims and exact evidence excerpts.
10. Run an independent entailment verifier.
11. If rejected, run one bounded repair attempt using the rejection reason.
12. Store the accepted value or an honest unknown with the complete attempt trail.

The existence of search results is not a success condition. The success condition is acceptable evidence for the exact parameter.

## Confidence contract

### Verified

All must be true:

- Value passes the parameter’s type/schema validator.
- Required freshness passes.
- Candidate and product identity pass.
- Evidence source class is allowed.
- The verifier finds direct entailment for the exact stored value.
- Minimum direct-source count passes.
- No unresolved contradiction exists.

### Inferred

- Policy permits inference.
- Directly supported premises are stored as evidence.
- The inference step is explicit and limited.
- The result is not presented as a directly reported fact.

### Unknown

- No accepted value after the bounded policy completes, or evidence conflicts materially.
- Value is null in the canonical cell result.
- Research attempts and rejected evidence remain available in experiment storage.

The extraction model never has final authority to mark a cell verified.

## Independent verification

The first implementation can use a separate OpenRouter model family already supported by VentureX, plus deterministic rules. The verifier receives:

- Candidate identity.
- Parameter definition and proof rule.
- Proposed structured value.
- Only the evidence excerpts and metadata.

It must not receive the extractor’s confidence label. Its output is a strict schema:

- `supports_exact_value`
- `candidate_match`
- `product_scope_match`
- `freshness_pass`
- `source_allowed`
- `contradiction_detected`
- `unsupported_value_paths`
- concise reason

## A/B experiment design

### Freeze the inputs

- Candidates: Vertiv Holdings, Schneider Electric, EMS Elektro Metall Schwanenmühle.
- Parameters: the existing three universal, four framework, and three dynamic keys listed above.
- Venture profile and parameter prompts: unchanged.
- Research date/window: recorded explicitly.

### Capture the baseline

Before any V2 live run:

1. Export the current database cells, citations, snippets, confidence, and reasons into a versioned fixture.
2. Retain the scored CSV as a human-readable artifact, but do not rely on it alone because CSV exports only the first citation and omit some internal provenance.
3. Register the snapshot as a `v1_snapshot` research run or equivalent fixture.

### Run V2 without overwriting V1

- Write V2 results to `cell_research_results` and `cell_evidence`.
- Produce a comparison artifact with baseline and V2 side by side.
- Randomize left/right presentation for human quality review where practical.
- Do not rerun Stage 6 scoring as part of the cell-quality decision.

### Human adjudication

Create `test-cases/abb-rack-pdu/cell-quality-gold.json` with one record per cell:

- Accepted value or acceptable value range/shape.
- Required proof semantics.
- Allowed source classes.
- Freshness rule.
- Whether inference is acceptable.
- Reviewer verdict for V1 and V2.
- Notes on false positives, omissions, and ambiguous cases.

Review quality before looking at provider cost. Then reveal cost and latency to judge the tradeoff.

## Metrics

Primary metrics:

1. **Value correctness** — accepted value matches the adjudicated fact.
2. **Citation entailment precision** — evidence explicitly supports the stored value.
3. **Semantic false-positive count** — especially relationships, reference wins, and exact product capabilities.
4. **Source-authority rate** — proportion grounded in allowed primary/authoritative sources.
5. **Freshness pass rate** — dynamic facts satisfy their date policy.
6. **Unknown calibration** — unsupported facts become unknown rather than plausible guesses.

Operational metrics:

- Coverage by confidence.
- Searches and fetched pages per cell.
- Provider contribution and failure rate.
- Cost per cell and per run.
- End-to-end and per-cell latency.
- Repair-loop frequency and improvement.
- Human verification time.

Do not optimize the verified count in isolation. A conservative unknown is better than a confidently wrong relationship.

## Acceptance criteria for the first 3×10 run

Hard gates:

- Exactly 30 V2 results for the frozen candidates and parameters.
- Every verified or inferred result has stored evidence.
- Zero fabricated URLs, titles, dates, or evidence excerpts.
- At least 29 of 30 cells have the correct adjudicated outcome: a supported value or a justified unknown.
- At least 95% of non-null values pass citation-entailment review; the goal is 100%.
- Zero semantic false positives across the nine relationship/reference/product-mechanism cells.
- Every dynamic date passes its policy or is unknown.
- Every unknown records the completed bounded attempt plan.
- No provider secret or authorization header appears in logs or persisted payloads.
- Hard run cost cap of $10 is enforced.
- Perplexity call count is zero.

Comparative success:

- V2 beats V1 on citation entailment and semantic false-positive count.
- V2 does not achieve that improvement merely by converting most cells to unknown.
- The quality gain is large enough to justify the additional complexity and latency.
- Harry can inspect why each V2 cell passed, failed, or remained unknown.

Soft targets:

- Total V2 run cost under $5.
- End-to-end time under 15 minutes for 30 cells with bounded concurrency.
- Human verification under 10 minutes after the evidence UI/artifact is available.

## Implementation phases

### Phase 0 — Freeze and harness

- Snapshot V1 ABB cells with full provenance.
- Add the 30-cell evaluation fixture skeleton.
- Add run-level cost and latency accounting.
- Add provider mocks and recorded response fixtures.

Exit: baseline cannot be overwritten accidentally and the comparison can run offline.

### Phase 1 — Persistence and contracts

- Add experiment/run/evidence/provider-call migrations and RLS.
- Add shared provider/domain types and schemas.
- Add promotion logic contract without wiring it to the UI.
- Update `.env.example` with blank provider configuration.

Exit: one mocked cell can travel from provider response to stored evidence/result.

### Phase 2 — Provider adapters

- Wrap existing Exa search rather than deleting it.
- Add Exa Contents.
- Add Brave Search.
- Add Bright Data Web Unlocker fallback.
- Add SEC, GLEIF, and Companies House official adapters.
- Add disabled Perplexity adapter interface and fixtures.

Exit: contract tests and one live smoke test per enabled provider pass.

### Phase 3 — Ten research policies

- Encode the ten policy definitions.
- Add company alias/identity resolution.
- Add parameter-specific query planning and validators.
- Add source ranking, URL canonicalization, and deduplication.

Exit: each ABB parameter has a bounded, testable research plan.

### Phase 4 — Extraction, verification, and repair

- Add evidence extraction prompt/schema.
- Add the independent verifier and deterministic checks.
- Add one rejection-driven repair attempt.
- Compute final confidence from policy outcomes.

Exit: fixture tests reject the known ABB overclaims: NVIDIA-as-OEM, adjacent liquid-cooling reference wins, manufacturing-as-R&D, and busbar-without-tap-off.

### Phase 5 — Paired run

- Predict cost and require confirmation if above the soft target.
- Run the frozen 3×10 case once through V2.
- Generate a side-by-side JSON/CSV/HTML comparison artifact.
- Adjudicate all 30 cells and calculate metrics.
- Decide whether V2 is promotable; do not promote automatically.

Exit: written comparison shows quality, coverage, cost, latency, and provider contribution.

## Proposed file map

Exact names may shift during implementation, but ownership should remain separated:

```text
src/lib/research/
  types.ts
  policies.ts
  query-planner.ts
  source-ranker.ts
  identity.ts
  budget.ts
  providers/
    exa-search.ts
    exa-contents.ts
    brave.ts
    bright-data.ts
    perplexity.ts
    official/
      sec-edgar.ts
      gleif.ts
      companies-house.ts
  extraction.ts
  verification.ts
  orchestrator.ts

src/server/
  stage5-cells-v2.ts

prompts/
  stage_5_v2_extract_evidence.md
  stage_5_v2_verify_claim.md

insforge/migrations/
  0008_cell_research_runs.sql

scripts/
  snapshot-cell-baseline.mts
  compare-cell-research-runs.mts

test-cases/abb-rack-pdu/
  cell-quality-gold.json
  cell-quality-v1-snapshot.json
```

Tests should sit beside modules following current repository convention.

## Security and reliability requirements

- All provider calls are server-only.
- Validate all fetched URLs as public `http`/`https`; block localhost, private networks, cloud metadata endpoints, credentials in URLs, and unsafe redirects.
- Cap response bytes, extracted characters/tokens, redirects, timeouts, and concurrent requests.
- Sanitize provider errors before persistence or UI display.
- Never log keys, bearer tokens, headers, or complete confidential venture prompts to external-provider logs.
- Treat fetched pages as untrusted data and defend extraction prompts against instruction injection.
- Cache content by canonical URL and retrieval policy to avoid paying repeatedly.
- Record content hashes so evidence can be traced to the retrieved version.
- Respect vendor and source-site terms, robots policies where applicable, and rate limits.
- Tests use mocks/fixtures by default; live-provider tests require an explicit flag.

## Testing strategy

### Unit tests

- Provider normalization.
- Policy routing and budgets.
- Date/freshness validation.
- Candidate/product identity matching.
- URL canonicalization and SSRF controls.
- Exact parameter validators.
- Confidence computation.
- Repair-loop stop conditions.

### Recorded integration tests

- Representative Exa, Brave, Bright Data, SEC, GLEIF, and Companies House responses.
- PDFs, JavaScript-rendered pages, missing dates, duplicate URLs, conflicting sources, irrelevant search hits, and provider errors.
- All recorded fixtures scrub request IDs or metadata that should not be committed.

### Adversarial ABB tests

The verifier must reject:

- NVIDIA collaboration as proof of a server OEM/integrator relationship.
- A general Lenovo partnership unless the evidence connects it to the relevant product arrangement.
- Equinix liquid cooling or a Google tenancy as proof of a rack-PDU deployment.
- Manufacturing investment as proof of R&D capacity.
- A generic busbar product as proof of a productized tap-off unit.
- Undated news as the latest event in a rolling 12-month window.

### Quality gates

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:run`
- Provider secrets absent from Git diff and logs.
- V1 canonical cells unchanged before explicit promotion.

## Parallel-workstream handoffs

| Engineering task | Can start without credentials? | Service dependency |
|---|---|---|
| Schemas, migrations, provider contracts, mocks | Yes | None |
| Policies and validators | Yes | None |
| Recorded fixture tests | Yes | Public documentation/sample payloads |
| Exa live smoke test | No | Exa ready |
| Brave live smoke test | No | Brave key and storage terms |
| Bright Data live smoke test | No | API key and Web Unlocker zone |
| Companies House live smoke test | No | API key |
| SEC/GLEIF smoke tests | Yes | Contact string for SEC |
| Live ABB V2 run | No | All enabled providers ready and capped |
| Perplexity test | Deferred | Explicit later authorization |

## After 3×10 succeeds

The next two experiments test different failure axes and must not be conflated:

### Scale axis: 10 → 50 parameters

- Keep the same three ABB candidates.
- Expand policies in coherent parameter families.
- Measure whether shared company evidence can be reused without causing cross-parameter citation leakage.
- Track cost, latency, unknown rate, and verification precision as parameter count increases.

### Familiarity axis: famous → obscure companies

- Keep a fixed, representative parameter subset.
- Test at least one globally documented public incumbent, one specialist/private mid-market company, and one obscure regional or early-stage company.
- Measure alias-resolution failures, source availability, registry coverage, local-language performance, and unknown calibration separately.

Passing Coca-Cola or Rio Tinto is not evidence that VentureX can research an early-stage Eastern European micromobility provider. Production readiness requires acceptable performance on both axes, especially a low false-positive rate when public evidence is sparse.

## Definition of done

This engineering milestone is complete when:

- The V1 ABB result is frozen and reproducible.
- The V2 provider-routed pipeline produces exactly 30 isolated experiment results.
- Evidence and provider attempts are fully auditable.
- The hard acceptance gates pass or failures are documented without hiding them.
- A side-by-side comparison quantifies correctness, evidence precision, coverage, cost, latency, and human verification time.
- No V2 result has overwritten canonical cells without explicit approval.
- We have a clear go/no-go decision for the 50-parameter and obscure-company experiments.

## Implementation result — 2026-07-12

The V2 architecture, migration, ten parameter policies, provider adapters,
independent verification, bounded retries, model failover, error-only resume,
targeted cell replay, budget enforcement, immutable baseline, and comparison
harness are implemented. Migration `0008_cell_research_runs.sql` is live.

The final isolated ABB run is
`0db6f7a6-43c5-46f2-967e-248a15dbfb14`. It contains exactly 30 results,
30 cells with evidence, and zero operational cell errors. Canonical `cells`
were not promoted or modified.

See `CELL_RESEARCH_ABB_RESULTS.md` and
`outputs/cell-improve-0db6f7a6/` for the outcome and side-by-side artifacts.
The current decision is **do not promote and do not expand to 50 parameters
yet**. First complete human adjudication and address coverage, latency, shared
evidence reuse, and the remaining provider configuration failures.
