# Cell Research V2 — ABB 3×10 Result

Date: 2026-07-12  
Branch: `cell-improve`  
Venture: `cf724783-065c-44c8-93a4-be29cb154ff9`  
Final V2 run: `0db6f7a6-43c5-46f2-967e-248a15dbfb14`  
Decision: **successful 0→1 architecture test; do not promote yet**

## What ran

The frozen candidates were Schneider Electric, Vertiv Holdings, and EMS
Elektro Metall Schwanenmühle. The frozen parameters covered identity,
headcount, current events, offering, pricing, sales cycle, R&D, product
mechanism, OEM/integrator relationships, and hyperscaler references.

V1 remained immutable. V2 wrote only to the experiment tables created by
`0008_cell_research_runs.sql`. Perplexity was disabled and canonical `cells`
were not changed.

Live providers used successfully were Exa Search, Exa Contents, Brave Search,
and GLEIF. SEC, Companies House, and Bright Data were wired and failed soft
because of configuration issues documented in
`CELL_RESEARCH_SERVICE_SETUP.md`.

## Final result

| Metric | V1 | V2 |
|---|---:|---:|
| Verified | 8 | 10 |
| Inferred | 13 | 1 |
| Unknown | 9 | 19 |
| Cells with stored evidence | not comparable in V1 schema | 30/30 |
| Operational cell errors | — | 0 |

Confidence transitions:

| Transition | Cells |
|---|---:|
| inferred → verified | 2 |
| verified → verified | 7 |
| unknown → verified | 1 |
| inferred → inferred | 1 |
| inferred → unknown | 10 |
| verified → unknown | 1 |
| unknown → unknown | 8 |

V2 retained 165 evidence records: 133 official-company, 6 official-filing, 4
official-registry, 4 news, and 18 other records. Ten cells ended with accepted
direct evidence and one with accepted inferred evidence. The remaining 19
retained rejected evidence and an explicit reason for staying unknown.

## Cost and latency

- Final cumulative V2 run cost, including targeted reliability and policy
  replays: **$5.8841**.
- The first complete pass cost **$4.7393**. The additional spend exposed and
  fixed transport retry, model failover, finalization retry, corporate-domain
  alias, and fact-effective-date issues.
- The hard cap remained $10; Perplexity spend was $0.
- The serial reliability run took approximately **17,134 seconds (4h45m)**.
  This misses the 15-minute soft target by a wide margin and is a hard blocker
  for a 50-parameter experiment in the current execution shape.

The cost is acceptable for a PoC; the latency is not. A fresh run using the
hardened code should avoid replay spend, but no lower end-to-end latency is
claimed until measured.

## What the PoC proved

1. Parameter-specific proof rules materially reduce semantic overclaiming.
   Relationship, hyperscaler, sales-cycle, and R&D claims now become unknown
   when exact evidence is absent instead of inheriting plausible model
   intuition.
2. Independent verification plus deterministic checks catches errors the
   extractor alone misses. The Schneider headcount replay exposed the
   difference between a page publication date and the effective date of a
   workforce figure.
3. Official identity sources add clear value. GLEIF supported legal-name
   verification for all three candidates without a paid key.
4. Honest unknowns are auditable. Every final cell has evidence, even when no
   value was accepted.
5. Error-only resume and targeted replay allow policy and reliability fixes
   without repaying for all 30 cells.

## What it did not prove

- Human correctness and citation-entailment gates are not yet passed. The
  30-cell gold fixture is still an adjudication skeleton, so the required
  29/30 correctness and 95% entailment metrics cannot yet be claimed.
- Comparative success is not yet established. V2 increased verified cells but
  also moved unknown coverage from 30% to 63%. Some of that is desirable
  calibration; some may be recoverable with better official sources and query
  policy.
- The intended provider mix was not fully exercised. Bright Data, SEC, and
  Companies House need configuration repair and another smoke test.
- The InsForge direct-link key should be rotated because the official CLI
  echoed it in private tool output during migration verification. It was not
  committed to Git or included in the comparison artifacts.
- The architecture does not yet meet scale latency. It made repeated searches
  and fetches for evidence that could be shared across a candidate.
- Famous-company performance says nothing yet about obscure or local-language
  companies.

## Decision and next gate

Do not promote this V2 run to canonical cells and do not start the 3×50 or
obscure-company experiment yet.

Complete these next:

1. Fix the Bright Data zone, SEC user-agent contact, and Companies House key;
   rerun only the seven-call smoke suite.
2. Blind-review all 30 V1/V2 pairs and fill
   `test-cases/abb-rack-pdu/cell-quality-gold.json`.
3. Separate desirable unknowns from false unknowns and tune only the latter.
4. Add candidate-level content caching/evidence reuse, safe bounded parallelism,
   and a measured latency target before expanding parameter count.
5. Re-run one clean 3×10 from scratch. Promotion is considered only if the
   human gates pass, semantic false positives remain zero, and latency improves
   substantially.

## Artifacts

- `outputs/cell-improve-0db6f7a6/comparison.html` — inspectable side-by-side
  evidence view.
- `outputs/cell-improve-0db6f7a6/comparison.csv` — compact paired result.
- `outputs/cell-improve-0db6f7a6/comparison.json` — complete machine-readable
  result and evidence.
- `test-cases/abb-rack-pdu/cell-quality-v1-snapshot.json` — immutable V1
  baseline.
- `test-cases/abb-rack-pdu/cell-quality-gold.json` — human-adjudication fixture
  to complete next.
