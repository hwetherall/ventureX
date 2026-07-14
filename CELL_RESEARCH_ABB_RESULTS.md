# Cell Research V2 — ABB 3×10 Result

Date: 2026-07-13
Branch: `cell-improve`
Venture: `cf724783-065c-44c8-93a4-be29cb154ff9`
Final clean V2 run: `72a9b395-7c7c-4cb2-b9ce-c2d5a91141c0`
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
Bright Data Web Unlocker, GLEIF, and SEC EDGAR. Companies House remains wired
but is deliberately deferred; none of the three frozen candidates is a UK
business, so the clean run made no Companies House calls.

## Final result

| Metric                     |                          V1 |    V2 |
| -------------------------- | --------------------------: | ----: |
| Verified                   |                           8 |    12 |
| Inferred                   |                          13 |     3 |
| Unknown                    |                           9 |    15 |
| Cells with stored evidence | not comparable in V1 schema | 30/30 |
| Operational cell errors    |                           — |     0 |

Confidence transitions:

| Transition          | Cells |
| ------------------- | ----: |
| inferred → verified |     3 |
| verified → verified |     8 |
| unknown → verified  |     1 |
| inferred → inferred |     3 |
| inferred → unknown  |     7 |
| unknown → unknown   |     8 |

V2 retained 164 evidence records: 142 official-company, 10 official-filing, 4
official-registry, 1 news, and 7 other records. Twelve cells ended verified,
three inferred, and fifteen retained rejected evidence plus an explicit reason
for staying unknown.

## Cost and latency

- The clean run cost **$5.1681**, exceeding the $5 soft target by $0.1681 while
  remaining below the configured $8 hard cap. Perplexity spend was $0.
- End-to-end latency was **977 seconds (16m17s)**, 17.5× faster than the prior
  17,134-second reliability run and 77 seconds over the 15-minute soft target.
- Provider calls were GLEIF 3, SEC EDGAR 12, Brave 73, Exa 231, OpenRouter 92,
  and Bright Data 8. Companies House and Perplexity were both 0.

Cost and latency are now close to the PoC soft targets rather than scale
blockers by themselves. The remaining gate is measured human correctness and
citation entailment, followed by targeted optimization of false unknowns.

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
  also moved unknown coverage from 30% to 50%. Some of that is desirable
  calibration; some may be recoverable with better official sources and query
  policy.
- The intended active provider mix was exercised. Companies House remains a
  deferred UK-only adapter and is not a blocker for this experiment.
- The InsForge direct-link key should be rotated because the official CLI
  echoed it in private tool output during migration verification. It was not
  committed to Git or included in the comparison artifacts.
- The clean run narrowly missed the 15-minute soft target and still repeated
  searches and fetches that could be shared across a candidate.
- Famous-company performance says nothing yet about obscure or local-language
  companies.

## Decision and next gate

Do not promote this V2 run to canonical cells and do not start the 3×50 or
obscure-company experiment yet.

Complete these next:

1. Blind-review all 30 V1/V2 pairs and fill
   `test-cases/abb-rack-pdu/cell-quality-gold.json`.
2. Separate desirable unknowns from false unknowns and tune only the latter.
3. Add candidate-level content caching/evidence reuse, safe bounded parallelism,
   and a measured latency target before expanding parameter count.
4. Promote only if the human gates pass and semantic false positives remain
   zero; otherwise replay only the policies or cells that fail adjudication.

## Artifacts

- `outputs/cell-improve-72a9b395/visual-comparison.html` — CEO-shareable
  before/after matrices, executive summary, and print-to-PDF layout.
- `outputs/cell-improve-72a9b395/comparison.html` — inspectable side-by-side
  evidence view.
- `outputs/cell-improve-72a9b395/comparison.csv` — compact paired result.
- `outputs/cell-improve-72a9b395/comparison.json` — complete machine-readable
  result and evidence.
- `test-cases/abb-rack-pdu/cell-quality-v1-snapshot.json` — immutable V1
  baseline.
- `test-cases/abb-rack-pdu/cell-quality-gold.json` — human-adjudication fixture
  to complete next.

## Targeted Perplexity post-pass — 2026-07-13

Perplexity was subsequently activated as an explicit post-pass for seven
approved unknown cells. It did not participate in the ordinary 30-cell pass,
and its prose synthesis was never accepted as evidence or as a cell value.
VentureX independently fetched Perplexity-discovered URLs, combined them with
the first-pass evidence, and ran the existing extractor and verifier.

The original clean run remains immutable. The final audit chain is:

- First pass: `72a9b395-7c7c-4cb2-b9ce-c2d5a91141c0`
- Seven-cell post-pass: `f7de3e3c-cb64-4ec9-a952-c897e5cae760`
- One-cell operational retry and final result:
  `60092d5e-c537-4c96-85ba-cf71d1723efc`

| Metric             | First pass | Final post-pass |
| ------------------ | ---------: | --------------: |
| Verified           |         12 |              13 |
| Inferred           |          3 |               3 |
| Unknown            |         15 |              14 |
| Target cells fixed |          — |             1/7 |
| Total run cost     |    $5.1681 |         $8.5404 |
| Incremental cost   |          — |         $3.3723 |

Vertiv's server-OEM/integrator cell improved from unknown to verified. Official
Vertiv evidence supports Lenovo, Ingram Micro, TechData, and CDW in relevant
rack-PDU proof, resale, or purchase relationships.

The other six cells remained unknown. Five are useful negative results: the
new evidence still lacked an exact sales-cycle duration, a dated total
headcount, or rack-PDU-specific hyperscaler proof. Schneider's OEM cell is a
known conservative false unknown: Dell is directly supported, but the
extractor also proposed HPE and Lenovo; the verifier rejected those two list
positions, so the all-or-nothing value rule withheld the whole list rather than
silently pruning it.

One Schneider request failed before billing with a transient `fetch failed`
error. It was retried as a one-cell cloned run after adding one bounded retry
for transient network, 408, 429, and 5xx failures. The retry completed normally.
There were eight Perplexity audit records in the final run chain: seven valid
research completions plus the zero-cost failed attempt.

Canonical `cells` remain unchanged. The post-pass artifacts are:

- `outputs/cell-improve-60092d5e/perplexity-delta.html` — focused seven-cell
  first-pass-to-Perplexity executive comparison.
- `outputs/cell-improve-60092d5e/visual-comparison.html` — updated full 3×10
  V1-to-final comparison.
- `outputs/cell-improve-60092d5e/comparison.html` — final evidence inspector.
- `outputs/cell-improve-60092d5e/perplexity-delta.json` and `.csv` — focused
  machine-readable results.
