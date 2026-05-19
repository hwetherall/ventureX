# Stage 2 — Parameter Builder

**Project:** VentureX (internal competitive landscape tool)
**Stage:** 2 — Parameter Builder (the Y-axis of the competitor table)
**Status:** V1 strawman — 19 May 2026
**Owner:** Harry, with Felipe assisting

---

## 1. Role

You are a senior consultant on a competitive-landscape team. A previous stage has produced a finalized **VentureX profile** describing a venture across 7 strategic dimensions, plus dimension weights. A subsequent stage has produced **candidate competitor companies** (the X-axis). Your job at this stage is to design the **Y-axis** — the list of parameters along which every candidate will be evaluated.

You are NOT writing analysis. You are NOT scoring. You are choosing **what facts** the downstream Researcher Agent will go and collect. Better to add a parameter that turns out to have a blank cell for half the competitors than to miss a parameter that would have changed the read.

The output of this stage is a structured parameter list (JSON) that becomes the schema for Stage 3 cell generation. Each parameter you define is a column header. Each candidate will eventually get one cell per parameter.

---

## 2. Core principle: facts, not analysis

Competely-style outputs mix two very different objects under one row label:

- **Facts** — verifiable, citable, low-hallucination ("founded 2011", "HQ in Dublin", "ships UL-listed PDUs")
- **Analysis** — interpretive, subjective, prone to confabulation ("strong brand", "innovative culture", "growing positive sentiment")

This stage produces parameters that ask for **facts only**. Analysis is the job of the Innovera platform downstream. Mixing them here pollutes the input data, displaces the analyst's thinking, and gives the LLM permission to invent.

**Rule:** if a parameter cannot be answered by pointing to a URL, a filing, a product page, a regulatory database, or a public statement, it does not belong in this list. SWOT, sentiment, "differentiation as prose", and brand-feel parameters are explicitly excluded — see §11.

---

## 3. Three-tier architecture

The full parameter set has three tiers. Two are hardcoded (the same for every venture); one is generated dynamically per venture.

| Tier | Count | Source | Purpose |
|---|---|---|---|
| **1. Universal Hardcoded** | ~15 | Code constant | Identity, scale, status facts every analysis needs |
| **2. Framework Hardcoded** | 21 (3 × 7 dims) | Code constant | The Innovera 7-dimension spine. Guarantees every competitor is describable in the same language the analysis engine consumes. |
| **3. Dynamic Brief-Specific** | 10–20 | **LLM-generated this stage** | Parameters derived from the specific venture profile's substitution landscape and strategic risks. |

After this stage runs, the three tiers are merged into a single parameter list, sorted by tier, and emitted as the Stage 3 schema. Tiers 1 and 2 are reference content for the LLM — **you do not regenerate them**. You generate Tier 3 and only Tier 3.

---

## 4. Parameter metadata schema

Every parameter, regardless of tier, conforms to this schema:

```jsonc
{
  "id": "snake_case_stable_id",         // unique, stable across versions
  "name": "Human-readable name",         // shown in the UI
  "tier": "universal" | "framework" | "dynamic",
  "innovera_dimension":                  // for engine ingestion
    "product_solution" | "customers" | "transaction" | "partners" |
    "access" | "geography_regulatory" | "capital_asset" | "meta",
  "value_type":
    "enum" | "number" | "short_string" | "list" | "prose" | "url" | "object",
  "value_schema": { /* optional */ },    // enum values, object shape, list-item type
  "cell_budget": "atom" | "sentence" | "paragraph",
                                         // atom ≤10 words; sentence ~20–40 words;
                                         // paragraph ~60–100 words
  "citation_required": true | false,
  "source_preference": [                 // ordered preference list
    "official_company" | "official_third_party" |
    "news" | "industry_analyst" | "inferred"
  ],
  "prompt_hint": "1–2 sentences telling the Stage 3 Researcher Agent what to look for and where",
  "source_field":                        // Tier 3 only — JSONPath into the profile
    "dimensions.product_solution.substitution_landscape[0]" // or similar
}
```

`cell_budget` defines what the Summariser shrinks the Researcher's long-form content to in the visible cell. The full Researcher output is preserved in the JSON export for the Innovera engine regardless.

---

## 5. Tier 1 — Universal Hardcoded (reference, not for LLM regeneration)

Identity, scale, financial, and public-surface facts. Same across every venture.

| # | id | Name | Dim | value_type | cell_budget | cite |
|---|---|---|---|---|---|---|
| 1 | `legal_name` | Legal Name | meta | short_string | atom | ✓ |
| 2 | `common_name` | Common / Trading Name | meta | short_string | atom | — |
| 3 | `founded_year` | Founded Year | meta | number | atom | ✓ |
| 4 | `status` | Operating Status | meta | enum `[operating, acquired, defunct, pivoted, unknown]` | atom | ✓ |
| 5 | `hq_location` | HQ Location (City, Country) | meta | short_string | atom | ✓ |
| 6 | `ownership_type` | Ownership Type | meta | enum `[public, private, subsidiary, pe_backed, government, unknown]` | atom | ✓ |
| 7 | `parent_company` | Parent Company | meta | short_string \| null | atom | ✓ |
| 8 | `headcount` | Headcount (most recent disclosure) | meta | object `{value, as_of}` | atom | ✓ |
| 9 | `annual_revenue` | Annual Revenue | meta | object `{value, currency, fy, source_type: audited/estimated/reported}` | sentence | ✓ |
| 10 | `funding_ma_history` | Key Funding / M&A Events | meta | list of `{date, type, amount, counterparty}` | paragraph | ✓ |
| 11 | `key_leadership` | Key Leadership (top 2–3) | meta | list of `{name, role}` | sentence | ✓ |
| 12 | `primary_urls` | Public URLs | meta | object `{homepage, careers, pricing, blog, press, ir}` | atom each | — |
| 13 | `stock_ticker` | Stock Ticker / Exchange | meta | short_string \| null | atom | ✓ if public |
| 14 | `last_valuation` | Last Known Valuation | meta | object `{value, currency, as_of}` | sentence | ✓ |
| 15 | `latest_material_event` | Latest Material Event (past 12mo) | meta | object `{description, date}` | sentence | ✓ |

---

## 6. Tier 2 — Framework Hardcoded (reference, not for LLM regeneration)

Three parameters per Innovera dimension. This is the spine that lets the analysis engine ingest the table — every competitor ends up describable in the same 7-dimension language we used to profile VentureX.

### 6.1 product_solution

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 16 | `core_offering` | Core Product / Service Offering | prose | sentence | ✓ |
| 17 | `pipe_or_platform` | Pipe or Platform | enum `[pipe, platform, hybrid]` | atom + sentence justification | — |
| 18 | `differentiating_mechanism` | Key Differentiating Mechanism | prose | sentence | ✓ |

### 6.2 customers

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 19 | `customer_segment_type` | Customer Segment Type | enum `[B2C, B2B-SME, B2B-E, B2G, mixed]` | atom | — |
| 20 | `primary_buyer_persona` | Primary Buyer Title / Function | short_string | atom | — |
| 21 | `customer_concentration` | Customer Concentration | prose | sentence | ✓ |

### 6.3 transaction

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 22 | `revenue_model` | Revenue Model | enum `[unit_sales, subscription, licensing, fee_for_service, commission, advertising, rental, mixed]` | atom | — |
| 23 | `pricing_disclosure` | Pricing Disclosure & Tier Range | object `{disclosure: public/partial/opaque, range_low, range_high, notes}` | sentence | ✓ |
| 24 | `margin_profile` | Margin Profile | prose (gross margin % if disclosed, qualitative otherwise) | sentence | ✓ if public |

### 6.4 partners

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 25 | `supply_partners` | Key Supply Partners | list | sentence | ✓ |
| 26 | `distribution_partners` | Distribution Partners | list | sentence | ✓ |
| 27 | `strategic_alliances` | Strategic Alliances / JVs | list | sentence | ✓ |

### 6.5 access

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 28 | `gtm_motion` | Go-to-Market Motion | enum `[direct_sales, inside_sales, channel, plg, hybrid]` | atom | — |
| 29 | `sales_cycle_length` | Sales Cycle Length | short_string (qualitative if not disclosed) | atom | — |
| 30 | `acquisition_channels` | Primary Acquisition Channels (top 2–3) | list | sentence | — |

### 6.6 geography_regulatory

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 31 | `geographic_footprint` | Geographic Footprint (sales presence) | list of regions, weighted if disclosed | sentence | ✓ |
| 32 | `manufacturing_footprint` | Manufacturing Footprint | list of countries / sites | sentence | ✓ |
| 33 | `certifications` | Industry Certifications & Approvals | list — **only those relevant to the brief's vertical** | sentence | ✓ |

### 6.7 capital_asset

| # | id | Name | value_type | cell_budget | cite |
|---|---|---|---|---|---|
| 34 | `capital_intensity` | Capital Intensity | enum `[high, medium, low]` + sentence justification | sentence | — |
| 35 | `asset_type` | Primary Asset Type | enum `[hardware, software, services, data, brand, mixed]` | atom | — |
| 36 | `rd_capacity` | R&D Capacity (spend / centers / patents) | prose | sentence | ✓ if public |

Note `certifications`: the *list* of certifications is hardcoded as a parameter, but *which certifications matter* is vertical-specific. For VentureX, UL/CE/CCC/BIS appear here. For an LG appliance brief, Energy Star and FCC would appear. The Researcher Agent receives the brief-specific certification list as a `prompt_hint`.

---

## 7. Tier 3 — Dynamic Brief-Specific (THIS IS WHAT YOU GENERATE)

### 7.1 What to produce

Generate 10–20 parameters that are **specifically motivated by the venture profile you have been given**. Each parameter must:

1. **Trace back to a specific field in the venture profile.** Set `source_field` to the JSONPath of the supporting content — e.g., `dimensions.product_solution.substitution_landscape[2]`, `strategic_risks_and_uncertainties[1].risk`, `dimensions.geography_regulatory.market_accessibility_gaps`. A Tier 3 parameter without a `source_field` is invalid.
2. **Ask a question only relevant to this venture.** A parameter that would apply equally to any B2B-E hardware play is too generic — it belongs in Tier 2 or doesn't belong at all.
3. **Be answerable with a fact, not analysis.** Yes/no, presence/absence, named entity, certification number, kW range. Not "strength" or "quality of".
4. **Be tagged with the Innovera dimension it falls under.** This is how the analysis engine ingests it.

### 7.2 Sourcing — where Tier 3 parameters come from

Two fields in the venture profile are **load-bearing** for Tier 3 generation. Mine them deliberately:

1. **`dimensions.product_solution.substitution_landscape[]`** — every alternative mechanism listed here implies a parameter: "does this competitor offer mechanism X?". For VentureX, the five substitution mechanisms (busbar, power shelves, DC distribution, in-rack DC, server-mounted) imply five distinct parameters about which competitors have each one.

2. **`strategic_risks_and_uncertainties[]`** — every named risk implies one or more parameters that would let you assess whether a given competitor wins or loses on that risk. For VentureX, the "China accessibility gap" risk implies a `china_market_access` parameter; the "low-margin trap" risk implies a `dcim_software_attach` parameter; the "channel mismatch" risk implies two channel-reach parameters.

Secondary sources you may use:

- `dimensions.geography_regulatory.market_accessibility_gaps[]` — implies regional certification or local-entity parameters
- `dimensions.capital_asset.notes` — may imply manufacturing or R&D capacity parameters specific to this vertical
- `intended_end_state.minimum_success_criteria` — may imply customer-segment-specific parameters (e.g., named hyperscale logos)

### 7.3 What to AVOID in Tier 3

- Restating a Tier 1 or Tier 2 parameter under a different name
- Parameters answerable only by analyst opinion ("strategic fit", "innovation index")
- Parameters that require predicting the future ("will they enter the China market in 2027?")
- Parameters that depend on private data the Researcher can't access ("internal cost structure")
- Parameters that just re-encode the venture's own positioning ("does competitor X have ABB's heritage?")

---

## 8. Output schema

Emit a single JSON object:

```jsonc
{
  "venture_id": "string",                  // from input
  "generated_at": "ISO 8601 timestamp",
  "dynamic_parameters": [                  // 10–20 entries, Tier 3 only
    {
      "id": "snake_case",
      "name": "Human-readable",
      "tier": "dynamic",                   // always "dynamic" at this stage
      "innovera_dimension": "...",
      "value_type": "...",
      "value_schema": { /* optional */ },
      "cell_budget": "atom | sentence | paragraph",
      "citation_required": true,
      "source_preference": ["..."],
      "prompt_hint": "...",
      "source_field": "JSONPath into the venture profile"
    }
  ],
  "generation_notes": "≤800 chars, optional"  // e.g., "Generated 13 dynamic params; could not derive a meaningful parameter from risk #4 because it concerns ABB's internal M&A track record, which doesn't transfer to competitors"
}
```

Tiers 1 and 2 are appended by the orchestrator after this LLM call returns — you do not emit them.

---

## 9. Validation criteria (§13-style acceptance tests)

The orchestrator runs these after Stage 2. Fail any one and the run is rejected.

| ID | Check |
|---|---|
| `count_in_range` | `len(dynamic_parameters)` is in `[10, 20]` |
| `all_have_source_field` | Every parameter has a non-empty `source_field` |
| `source_field_resolves` | Each `source_field` is a valid JSONPath into the input profile |
| `all_have_dimension` | Every parameter has a non-null `innovera_dimension` from the 7-dim list (no `"meta"` in Tier 3) |
| `no_duplicates_with_hardcoded` | No `id` collides with any Tier 1 or Tier 2 `id`; no semantic duplicate (e.g., a Tier 3 `"product_offering"` after Tier 2 `core_offering`) |
| `no_analysis_parameters` | No parameter has `value_type: "prose"` AND `cell_budget: "paragraph"` AND `name` matches blocklist `[/strength/i, /weakness/i, /sentiment/i, /satisfaction/i, /culture/i, /vision/i, /mission/i]` |
| `at_least_one_per_load_bearing_risk` | For each entry in `strategic_risks_and_uncertainties` flagged high-confidence, at least one Tier 3 parameter has a `source_field` pointing at it (or the orchestrator records a justified skip in `generation_notes`) |
| `substitution_coverage` | For each entry in `dimensions.product_solution.substitution_landscape`, exactly one Tier 3 parameter exists asking "does the competitor offer this mechanism?" |

The keystone test case (ABB Rack PDU) passes Stage 2 if it produces at least 12 dynamic parameters, including `china_market_access`, `high_density_rack_support_kw`, `dcim_software_attach`, and at least one each for busbar, power shelf, DC distribution, and server-mounted power.

---

## 10. VentureX worked example — the 13 Tier-3 parameters

The output the LLM should produce for the ABB Rack PDU venture profile. **This is the strawman Y-axis for V1.**

| # | id | Name | Dim | Source field | Type | Budget |
|---|---|---|---|---|---|---|
| 37 | `high_density_rack_support_kw` | Max Rack Density Supported (kW) | product_solution | `strategic_risks_and_uncertainties` (10–20kW → 100–200kW) | `{low_kw, high_kw, notes}` | sentence |
| 38 | `dc_distribution_offering` | DC Distribution Product | product_solution | `dimensions.product_solution.substitution_landscape` ("DC distribution") | enum `[shipping, announced, none]` + notes | sentence |
| 39 | `busbar_offering` | Busbar / Tap-off Offering | product_solution | `substitution_landscape` ("busbar/tap-off") | enum `[shipping, announced, none]` + notes | sentence |
| 40 | `power_shelf_offering` | Power Shelf Offering | product_solution | `substitution_landscape` ("power shelves") | enum `[shipping, announced, none]` + notes | sentence |
| 41 | `server_mounted_power_offering` | Integrated Server-Mounted Power | product_solution | `substitution_landscape` ("server-mounted") | enum `[shipping, announced, none]` + notes | atom |
| 42 | `china_market_access` | China Market Access Mode | geography_regulatory | risk: "China $500M / $75M accessibility gap" | enum `[foreign_direct, jv, local_only, none]` + notes | sentence |
| 43 | `india_market_access` | India Market Access Mode | geography_regulatory | risk: "similar constraints in India" | enum `[foreign_direct, jv, local_only, none]` + notes | sentence |
| 44 | `pdu_certifications_held` | PDU-Specific Certifications Held | geography_regulatory | risk: "UL/CE regional cert reqs" | list `[UL, CE, CCC, BIS, KC, others]` | sentence |
| 45 | `dcim_software_attach` | DCIM Software Attach | product_solution | risk: "low-margin trap; software differentiation" | enum `[own, partner, none]` + product name | sentence |
| 46 | `it_channel_reach` | IT Distribution Channel Reach | access | risk: "channel mismatch — IT distribution" | enum `[strong, medium, weak, none]` + named partners | sentence |
| 47 | `electrical_channel_reach` | Electrical Distribution Channel Reach | access | parent context: "electrical-distribution heritage" | enum `[strong, medium, weak, none]` + named partners | sentence |
| 48 | `pdu_adjacent_ma_history` | PDU-Adjacent M&A History (past 5y) | capital_asset | risk: "Buy path consideration" | list `[{target, year, amount, rationale}]` | paragraph |
| 49 | `named_hyperscale_customers` | Named Hyperscale / Colocation Customers | customers | `intended_end_state.minimum_success_criteria` (hyperscale + colo) | list of named accounts (where public) | sentence |

Total parameter count for VentureX V1: **15 (Universal) + 21 (Framework) + 13 (Dynamic) = 49 parameters**, against 53 competitors → **2,597 cells** for Stage 3 to fill.

### 10.1 Two parameters fully specified

To show what each Tier-3 entry looks like with full metadata:

```jsonc
{
  "id": "china_market_access",
  "name": "China Market Access Mode",
  "tier": "dynamic",
  "innovera_dimension": "geography_regulatory",
  "value_type": "object",
  "value_schema": {
    "mode": "enum [foreign_direct, jv, local_only, none]",
    "local_entity": "string | null",
    "ccc_certified": "boolean",
    "notes": "string"
  },
  "cell_budget": "sentence",
  "citation_required": true,
  "source_preference": ["official_company", "official_third_party", "news"],
  "prompt_hint": "Look for: (1) China subsidiary or JV partner on the company's China site or in 10-K/annual report; (2) CCC certification on product pages; (3) named China data-center customer wins. Distinguish 'sells via export from outside China' (foreign_direct) from 'has local Chinese entity' (local_only) from 'JV with named Chinese partner' (jv).",
  "source_field": "strategic_risks_and_uncertainties[2].risk"
}
```

```jsonc
{
  "id": "dc_distribution_offering",
  "name": "DC Distribution Product",
  "tier": "dynamic",
  "innovera_dimension": "product_solution",
  "value_type": "object",
  "value_schema": {
    "status": "enum [shipping, announced, none]",
    "product_name": "string | null",
    "voltage": "string | null (e.g., '380VDC', '400VDC')",
    "notes": "string"
  },
  "cell_budget": "sentence",
  "citation_required": true,
  "source_preference": ["official_company", "industry_analyst", "news"],
  "prompt_hint": "Look for product pages mentioning DC distribution, 380VDC, 400VDC, HVDC, OCP DC power, or DC rack architectures. 'Announced' = press release or roadmap mention without a current shipping SKU. Distinguish from DC-input AC rack PDUs, which are still AC products.",
  "source_field": "dimensions.product_solution.substitution_landscape[2]"
}
```

---

## 11. What we explicitly cut from Competely (and why)

Competely's flat 135-parameter output mixes facts and analysis. The strawman Y-axis cuts the following categories. Daniel — flag any you want restored.

| Cut from Competely | Reason |
|---|---|
| SWOT (Strengths / Weaknesses / Opportunities / Threats) | Analysis, not fact. This is what the Innovera engine produces *over* the table, not *into* the table. |
| Customer Praises, Customer Complaints, Sentiment Trend Analysis, Online Review Scores, Customer Satisfaction Score | Sentiment work. Often hallucinated; weak signal for B2B-E industrial. If we want it, it deserves its own dedicated pass with proper review-mining tools. |
| Tagline, Tagline Variations, Brand Promise, Tone of Voice, Messaging Strategy | Marketing fluff. Low signal in industrial B2B-E. |
| Differentiation (Competely's bullet list of vague claims) | Replaced by structured `differentiating_mechanism` (Tier 2). |
| Update Frequency & Patch Management, Open Source Contributions, API Documentation | SaaS-specific. Vertical-mismatched for hardware. |
| PR & Media Strategy, Event / Sponsorship Strategy, Influencer / Advocate Network | Marketing-tactical, low strategic signal. |
| Mission Statement, Vision Statement, Company Culture & Values | Performative, low signal, often copied verbatim from About pages. |
| Employee Satisfaction | Unverifiable from public sources. |
| Use Cases (as Competely runs it — vague list) | Absorbed into `differentiating_mechanism` plus Tier 3 mechanism parameters. |
| Customizations | Too vague; absorbed into `core_offering`. |
| Product Roadmap | Speculative when sourced from public data only. |
| Multiple overlapping URL fields (Homepage, About, Pricing, Blog as separate rows) | Consolidated into one `primary_urls` object. |
| Multiple overlapping pricing fields (4–5 in Competely) | Consolidated into `revenue_model` + `pricing_disclosure` + `margin_profile`. |
| Market Size / Market Share / # Users / # Paying Customers | These are venture-level metrics, not competitor-level. Belong in the venture profile, not the competitor table. |

---

## 12. Anti-patterns

What a bad Tier-3 output looks like — for the LLM and the human reviewer.

**Bad parameter — too generic:**
```jsonc
{ "id": "competitive_strength", "name": "Competitive Strength", "value_type": "prose" }
```
*Why bad:* analysis, not fact; no source_field; would apply to any venture.

**Bad parameter — already in Tier 2:**
```jsonc
{ "id": "product_features", "name": "Product Features", "source_field": "dimensions.product_solution.jtbd" }
```
*Why bad:* `core_offering` already covers this. Tier 3 should add *brief-specific* differentiation, not restate Tier 2.

**Bad parameter — restates venture positioning:**
```jsonc
{ "id": "has_electrical_heritage", "name": "Has Electrical-Distribution Heritage" }
```
*Why bad:* this is ABB's pitch about itself. The relevant question is *which competitors also have it*, but as a binary it's not informative — and "electrical-distribution heritage" is fuzzy. Sharpen to `electrical_channel_reach` (Tier 3 #47) instead — that's the actionable underlying fact.

**Bad parameter — requires prediction:**
```jsonc
{ "id": "will_enter_china_2027", "name": "Will Competitor Enter China by 2027?" }
```
*Why bad:* facts only. The fact-question is `china_market_access` (current state). Forecasting belongs in the Innovera engine.

---

## 13. Inputs (appended at runtime)

Below this line, the orchestrator appends:

1. The full **VentureX profile JSON** (Stage 1 output, post-HITL)
2. The **canonical dimension weights** (Stage 2 weighting output)
3. *(Optional)* prior Tier 3 generations from earlier runs, marked as reference

---

## Appendix A — Dependencies on other stages

| Upstream | What we consume |
|---|---|
| Stage 1 (Profile Extraction) | `synthetic_description`, all 7 dimensions, `strategic_risks_and_uncertainties[]`, `gaps_in_input[]` |
| Stage 2 (Dimension Weighting) | Weights per dimension — used to prioritise which Tier-3 parameters to *emphasise* in `prompt_hint` (e.g., for high-weight dimensions, the hint should be more specific about what counts as a strong vs weak answer) |

| Downstream | What they consume |
|---|---|
| Stage 3 (Cell Generation — Researcher Agent) | The full parameter list (Tiers 1 + 2 + 3 merged), used as the schema for what to research per competitor |
| Stage 3 (Cell Generation — Summariser) | `cell_budget` per parameter, determines summary length |
| Stage 5 (Innovera Platform Feed) | `innovera_dimension` per parameter, determines how cells route into the engine's 7-dim ingestion |

## Appendix B — Open design questions (cross-ref: VentureX_Open_Questions.docx)

Items deliberately unresolved in this spec, deferred to the Daniel chat or the Step-3 planning session:

- **Citation format spec** (S2 / Daniel) — URL only, or URL + retrieval date + accessed-via-query? Single citation sufficient per fact, or multiple required for high-impact facts?
- **"Unknowable fact" enum** (S2 / Daniel) — for facts the Researcher can't find publicly, do we use `["not_disclosed", "estimated", "reported"]` or leave blank?
- **HITL edit privileges** (S2 / DPZ) — who can edit/delete/add Tier 3 parameters?
- **Researcher Agent architecture** (S3 / Felipe + Harry) — single-pass, multi-pass, RAG?
- **Citation granularity** (S3 / Daniel) — claim-level or cell-level?

---

*End of Stage 2 — Parameter Builder spec.*
