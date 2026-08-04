# Innovera Competitive Table — Parameter Shortlist (Part 2, cut)

**10 columns × 14 rows = 140 cells.** Down from 714 — an 80% cut.
Projected not-applicable: **~12 cells (9%)**, almost all in one row (see §5).

Every column below carries a **position enum** alongside its cited prose value. The enum is what makes variance measurable, whitespace computable, and Pedram's "similar on product, different on geography" readout renderable. Prose alone can't do any of those.

---

## 1. The shortlist

| # | Parameter | Dimension | Position enum |
|---|---|---|---|
| 1 | `who_does_the_thinking` | Product / Solution | `human_expert` · `software_only` · `hybrid_human_validated` · `buyer_themselves` |
| 2 | `auditable_provenance` | Product / Solution | `claim_level_traceable` · `source_cited` · `asserted` · `none` |
| 3 | `commercial_model` | Transaction | unit: `initiative` · `engagement` · `seat` · `subscription` · `retainer` · `equity_venture` · `none` <br> band: `<10k` · `10–100k` · `100–500k` · `500k+` · `n/a` |
| 4 | `grounded_in` | Partners | `client_corpus` · `licensed_external` · `both` · `ad_hoc_input` · `internal_only` |
| 5 | `time_to_first_usable_output` | Access | `minutes_hours` · `days` · `weeks` · `months` · `year_plus` |
| 6 | `procurement_path` ⚡ | Access | `existing_subscription` · `below_po_threshold` · `standard_procurement` · `full_enterprise_procurement` · `no_purchase` |
| 7 | `local_language_delivery` ⚡ | Geography / Regulatory | `board_grade_multi_apac` · `board_grade_single` · `english_plus_translation` · `english_only` |
| 8 | `marginal_cost_of_next_assessment` | Capital / Asset | `near_zero` · `sublinear` · `flat_linear` · `increasing` |
| 9 | `growth_initiative_purpose_built` | Tier 3 — category test | `purpose_built` · `adjacent_configurable` · `general_purpose` · `not_applicable` |
| 10 | `direction_of_travel` | Tier 3 — trajectory | `moving_toward` · `static` · `moving_away` · `consolidating` |

⚡ = the two columns most likely to produce an "Aha" — high variance, decision-relevant, and almost certainly not front-of-mind for James.

### Why each survived

**1 · `who_does_the_thinking`** — The spine. It cleaves all five archetypes in a single cell and every competitor answers it differently. Absorbs `human_validation_layer`, `forward_deployed_human_model` and most of `delivery_mechanism`.

**2 · `auditable_provenance`** — Innovera's central technical claim (reasoning graph, every conclusion traced). Consultancies score `asserted`, assistants score `source_cited` at best, Hebbia and AlphaSense genuinely compete here. Absorbs `accuracy_and_hallucination_controls`.

**3 · `commercial_model`** — Merged from `unit_of_sale` + `published_price_band` because a buyer thinks about them together and they're useless apart. The most visceral column in the table: $50K vs $800K–1.5M vs $20/seat/month. Absorbs `commitment_shape` and `pricing_transparency`.

**4 · `grounded_in`** — Client corpus vs licensed external content vs both vs whatever gets pasted in. Genuinely high variance, and the `both` position is sparsely occupied — which makes this the column most likely to *produce* the whitespace finding rather than just support it. Fills the Partners dimension.

**5 · `time_to_first_usable_output`** — Hours to eighteen months. Enormous spread, trivially searchable, and it's the claim Innovera's own comparison table leads with.

**6 · `procurement_path`** ⚡ — The sleeper. Whether the purchase clears inside the decision window is a *different question from price*, and it explains why $50K beats $800K in a way the price column alone never will: one clears below a PO threshold, one triggers six weeks of enterprise procurement, one is already in the building on an existing subscription. Nobody puts this in a competitive table. It also carries most of the buyer signal, since approval level implies approver.

**7 · `local_language_delivery`** ⚡ — The busbars column. Can this unit staff a board-grade engagement in Japanese, Korean or Thai? NRI can. McKinsey can. Hebbia can't. A San Francisco AI startup can't. Given that the client base is overwhelmingly APAC industrial, this is where Innovera actually wins deals — and it is invisible on the deck's 2×2.

**8 · `marginal_cost_of_next_assessment`** — The economics column. Separates consulting from software in one cell, and it's the question underneath "why won't McKinsey just do this." Investor-critical.

**9 · `growth_initiative_purpose_built`** — The empty-box thesis made falsifiable. Purpose-built vs adjacent-and-configurable vs general-purpose. If several rows land on `adjacent_configurable`, the category claim is in trouble and we'll know why.

**10 · `direction_of_travel`** — Makes the table forward-looking rather than a snapshot. AlphaSense shipping workflow agents, Wellspring absorbing Sopheon, Leap's gen-AI platform — these are the moves James is actually pricing. A static table answers last year's question.

---

## 2. The biggest structural cut: Tier 1 is not a column set

**All 15 Tier 1 parameters come out of the research budget and become the row header.**

`competing_unit`, `parent_entity`, `entity_type`, `operating_model`, `primary_offering_name`, `headquarters`, `stated_positioning` — these identify the row. They belong in the header block, rendered once, not as fifteen cells to research and scan across.

The rest of Tier 1 fails on its own merits:

- `year_unit_established`, `year_offering_launched` — vary, but nothing downstream changes. Relevance failure.
- `disclosed_financials`, `employees_or_practitioners` — almost never disclosed **at the competing-unit level**, which is the level we deliberately chose in Part 1. Searchability failure created by our own decomposition. Parent-level figures would reintroduce exactly the $15B-firm-vs-100-person-startup comparison the decomposition existed to kill.
- `viability_status` — nearly every row reads `durable`. Variance failure. The interesting cases (Sopheon into Wellspring) are captured better by `direction_of_travel`.
- `named_clients_disclosed` — superseded by the far sharper account-overlap question (§4).
- `public_source_of_truth` — pipeline plumbing, not a fact about the world.

This single move frees the entire column budget for parameters that discriminate.

---

## 3. The filter I applied beyond the three tests

Several Tier 3 parameters are **columns Innovera wins by construction**: `scenario_pathway_modelling` (MPS, "up to 3 pathways"), `frameworks_encoded` (RQA), `determinism_and_reproducibility` (the AI Control Layer slide), `forward_deployed_human_model` (FDA).

Each is individually defensible. Put four of them in a ten-column table and the table stops being an analysis and becomes a scorecard Innovera wrote for itself — and a VC who reads a lot of self-serving competitive grids will smell it in about nine seconds. The credibility cost is larger than the informational gain.

So they're on the bench, and the columns that survive are ones where Innovera can plausibly *lose* a cell: Hebbia beats Innovera on `grounded_in` depth for client corpora; frontier assistants win `time_to_first_usable_output` and `commercial_model` outright; NRI matches on `local_language_delivery`. A table where the subject loses three cells and still wins the argument is worth ten times one where it sweeps.

---

## 4. Bench — swap-ins, in priority order

1. **`primary_buyer`** (Customers) — the only dimension with no dedicated column. Genuinely varied (PE analysts, research analysts, COO, R&D portfolio lead, CEO/board, CIO). Cut because Part 1's row selection already encodes the buyer question and `procurement_path` carries the approval-level signal. **Swap in first if Pedram wants Customers explicitly represented** — reasonable, given it's his framework.
2. **`proprietary_asset`** (Capital/Asset) — the moat column, and the most painful cut. Out because it's interpretive rather than factual, which breaks the citation contract, and because it's largely reconstructable from `grounded_in` + `who_does_the_thinking`. Better as a derived view than a researched cell.
3. **`overlap_with_innovera_named_accounts`** — the most demo-tempting parameter in the longlist. Out on searchability: public client lists are partial and stale, so most cells would read `unknown`, which looks like a broken tool rather than an honest gap. **If the deal data arrives from the head of growth, this stops being a research column and becomes a sourced annotation layer — much stronger.**
4. **`scenario_pathway_modelling`** — best of the self-flattering group; swap in if a slot opens.
5. **`surfaces_omitted_risk`** — conceptually the sharpest thing in the longlist (it's the ABB substitution test applied to competitors) but it's a capability judgement, not a searchable fact. Revisit for V2 with a defined test protocol.

**Derived views, not columns** (computed from cited cells, never researched): `depth_vs_speed_position`, `price_band_vs_procurement_threshold`, `horizontal_vs_vertical`, `output_artifact`, `decision_vs_execution_locus`.

---

## 5. One row problem this creates

At 51 columns, `do_nothing_defer` had 45 not-applicable cells. At 10 columns it has roughly 8 — meaning **an almost entirely empty row, sitting in a demo, in front of an investor.** It will read as a broken tool no matter how correct it is.

Three options, in my order of preference:

1. **Merge `do_nothing_defer` into `internal_team`** as a single `status_quo` row with `who_does_the_thinking: buyer_themselves`. Takes the table to 13 rows and loses very little — the two behave near-identically on every surviving column.
2. Keep it as a **footnote row**, rendered visually distinct below the table, with a one-line annotation rather than cells.
3. Keep as-is and accept the empty row. Only if the demo explicitly narrates *why* it's empty, which is a real point — the most common loss has no vendor to compare against.

`internal_team` drops from 17 not-applicable cells to roughly 3 under the new frame, so it survives comfortably either way.

---

## 6. Open calls before research starts

- **Pricing inconsistency, unresolved from the deck.** $25K per initiative/year on the pricing slide, $50,000 on the comparison table. `commercial_model` is a headline column and Innovera's own cell can't have two values. Needs a ruling.
- **`local_language_delivery` scoring standard.** "Board-grade" needs a definition tight enough to cite — native-speaking senior staff in-country, or translated deliverables? The distinction decides whether McKinsey Japan and NRI land on the same position.
- **Does the 10-column frame get shown to Pedram before the research run?** If he's going to want `primary_buyer` or `frameworks_encoded` back, far cheaper to know now than after 140 cells are filled.

---

*Feeds the research stage. Row set from Part 1; cell contents fill against the position enums above, each with a mandatory citation per the standing rule.*