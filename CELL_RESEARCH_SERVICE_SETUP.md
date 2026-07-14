# Cell Research Improvement — Service Setup Workstream

Status: active PoC providers validated; targeted Perplexity post-pass live;
Companies House deliberately deferred
Owner: Harry
Engineering counterpart: `CELL_RESEARCH_ENGINEERING_PLAN.md`

## Purpose

This workstream provisions the external services needed for the first cell-quality experiment. It deliberately separates account, commercial, credential, and data-rights work from implementation so engineering can proceed against provider mocks while accounts are being created.

The first experiment is the existing ABB rack-PDU **3 candidates × 10 parameters** case. It must remain cheap, reproducible, and directly comparable with the existing Exa + Claude result.

## Locked scope

### Activate for the first experiment

- Exa paid search/content access (called “Exa Plus” internally; use the currently available paid plan rather than relying on a historical plan name).
- Brave Search API.
- Bright Data Web Unlocker API.
- Official public APIs, beginning with SEC EDGAR and GLEIF. The Companies
  House adapter remains available but is deferred until UK companies enter a
  research set.
- Perplexity Sonar Deep Research only as an explicitly allowlisted post-pass
  after the cheaper provider-routed pass has completed.

### “Yes, but later”

- AlphaSense, PitchBook, Factiva, or similar premium content/data platforms.
- Bright Data Browser API or residential proxy products.
- Paid global company registries unless the official/free route proves inadequate.

The first implementation may define a disabled Perplexity adapter and environment variables, but it must not make Perplexity calls or require a Perplexity account to complete the experiment.

## Provisioning decisions

| Service         | Initial product     | Why we need it                                                                                       | Initial spend posture                                                                 | Credential / configuration                 |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Exa             | Search + Contents   | Semantic discovery, related pages, full text and PDF extraction                                      | Keep the smallest paid plan that supplies the required rate limits; set a monthly cap | `EXA_API_KEY`                              |
| Brave           | Search API          | Independent lexical/news index; reduces dependence on Exa’s ranking and recall                       | Start with Search rather than Answers; usage is tiny for 3×10                         | `BRAVE_SEARCH_API_KEY`                     |
| Bright Data     | Web Unlocker API    | Fetch public pages that normal HTTP or Exa cannot reliably retrieve because of blocking or rendering | Free tier or pay-as-you-go; do not buy Browser API yet                                | `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_ZONE`  |
| SEC EDGAR       | Public REST APIs    | US public-company identity, filings, financial facts, and recent 8-K/10-K/10-Q evidence              | Free; no API key                                                                      | `SEC_USER_AGENT`                           |
| GLEIF           | Public API          | Legal entity names, identifiers, addresses, and ownership relationships                              | Free; no API key                                                                      | None                                       |
| Companies House | Public API          | Future live UK company and officer data                                                              | Deferred until a UK case                                                              | `COMPANIES_HOUSE_API_KEY`                  |
| Perplexity      | Sonar Deep Research | Targeted escalation for genuinely hard, unresolved cells                                             | Separate per-run cap; disabled during ordinary research                               | `PERPLEXITY_API_KEY`, explicit enable flag |

Official product pages:

- Exa pricing and capabilities: https://exa.ai/pricing
- Brave Search API: https://brave.com/search/api/
- Bright Data Web Unlocker: https://brightdata.com/pricing/web-unlocker
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- GLEIF API: https://www.gleif.org/en/lei-data/gleif-api/
- Companies House developer portal: https://developer.company-information.service.gov.uk/
- Perplexity Sonar Deep Research: https://docs.perplexity.ai/docs/sonar/models/sonar-deep-research

## Harry’s checklist

### 1. Exa

- [ ] Confirm which Exa account/project currently supplies `EXA_API_KEY`.
- [ ] Confirm the account has access to Search and Contents, including PDFs and full-page text.
- [ ] Upgrade only if the existing allowance or rate limit is insufficient for development and the 3×10 comparison.
- [ ] Set the lowest practical monthly spend alert/cap.
- [ ] Generate a server-side key specifically for VentureX if the current key is shared with another product.
- [ ] Confirm the contract permits VentureX to retain URLs, titles, short evidence excerpts, timestamps, and derived structured values.
- [ ] Record the plan name, quota, rate limit, and billing owner in the service register below.

### 2. Brave Search

- [ ] Create a Brave Search API account and project for VentureX.
- [ ] Select the Search API product, not the Answers product.
- [ ] Generate a server-side API key.
- [ ] Set a monthly alert/cap. The 3×10 run should consume only a tiny fraction of the entry allowance.
- [ ] Ask Brave support or confirm in the selected terms whether the plan grants the storage rights needed to retain result metadata and evidence excerpts. Brave’s public documentation says result storage requires an appropriate plan.
- [ ] Record any excerpt-display or attribution requirements.

### 3. Bright Data

- [ ] Create a Bright Data organization/project for VentureX.
- [ ] Create one Web Unlocker zone named `venturex_research` or equivalent.
- [ ] Use pay-as-you-go or the free allowance; do not enable Browser API, residential proxies, premium domains, or custom headers by default.
- [ ] Generate an API key restricted to the research project if Bright Data supports that control.
- [ ] Set a strict monthly spend limit and success-only billing alerts.
- [ ] Confirm the intended use is limited to publicly accessible pages and complies with target-site terms and applicable law.
- [ ] Record which premium domains, if any, have materially different pricing.

### 4. Official APIs

- [ ] Decide the contact string VentureX will send as `SEC_USER_AGENT`, for example `VentureX research <operations email>`.
- [ ] Create a live Companies House application and API key when a UK case is scheduled.
- [ ] Confirm SEC and GLEIF require no credentials and are reachable from the deployed environment.
- [ ] Provide a general operations email for API-contact and rate-limit notices.
- [ ] Do not purchase OpenCorporates or another registry yet; list countries where official access is inadequate and revisit after the 3×10 test.

### 5. Perplexity post-pass

- [x] Create a separate API key for the VentureX PoC.
- [x] Keep the ordinary research path disabled by default.
- [x] Require an explicit target allowlist, maximum cell count, separate
      budget, and complete provider-call logging.
- [ ] Set an account-level monthly alert/cap in the Perplexity dashboard.
- [ ] Confirm production retention, training, and data-processing terms.

## Credential handoff

Credentials must never be pasted into an issue, planning document, chat transcript, test fixture, source file, or committed `.env` file.

For local scripts in this repository, add the following only to the gitignored
`.env` file. (`.env.local` remains suitable for the Next.js app, but the
research scripts explicitly load `.env`.)

```dotenv
# Cell research providers
EXA_API_KEY=
BRAVE_SEARCH_API_KEY=
BRIGHT_DATA_API_KEY=
BRIGHT_DATA_ZONE=venturex_research
SEC_USER_AGENT=VentureX research <operations-email>
COMPANIES_HOUSE_API_KEY=

# Disabled by default; enable only on an explicit post-pass command
PERPLEXITY_API_KEY=
CELL_RESEARCH_PERPLEXITY_ENABLED=false
CELL_RESEARCH_PERPLEXITY_REASONING_EFFORT=low
CELL_RESEARCH_PERPLEXITY_MAX_TOKENS=2500
CELL_RESEARCH_PERPLEXITY_SOFT_CAP_USD=4
CELL_RESEARCH_PERPLEXITY_HARD_CAP_USD=6
CELL_RESEARCH_PERPLEXITY_CELL_RESERVATION_USD=1.25
CELL_RESEARCH_PERPLEXITY_MAX_CELLS=7
```

Engineering will add blank, documented entries to `.env.example`; no real values belong there. Production credentials should be entered directly in the deployment platform’s secret manager.

## Service register

Fill this table without including secret values.

| Service         | Account owner | Project / zone | Plan | Monthly cap | Rate limit                   | Storage/display rights confirmed | Ready       |
| --------------- | ------------- | -------------- | ---- | ----------: | ---------------------------- | -------------------------------- | ----------- |
| Exa             |               |                |      |             |                              |                                  | ☐           |
| Brave           |               |                |      |             |                              |                                  | ☐           |
| Bright Data     |               |                |      |             |                              |                                  | ☐           |
| Companies House |               | Deferred       | Free |           0 |                              | Review before UK case            | N/A for ABB |
| SEC             |               | N/A            | Free |           0 | Published fair-access limits | Public-data terms reviewed       | ☐           |
| GLEIF           |               | N/A            | Free |           0 |                              | Public-data terms reviewed       | ☐           |

## Budget guardrails for the experiment

- Soft target: **under $5 total external-provider and model cost** for the new 30-cell run.
- Hard stop: **$8 for the run** without explicit authorization.
- No provider may retry indefinitely.
- Bright Data is a fetch fallback, not the default route for every URL.
- Perplexity is disabled during ordinary research and has its own explicit
  post-pass soft/hard caps.
- Provider costs must be logged per request and aggregated per run.
- A service returning an error must not silently trigger an unbounded paid fallback.

The purpose is to compare quality, not to demonstrate that spending more always wins.

## Smoke-test handoff

Once each credential is available, engineering will run a non-destructive smoke test that records:

- Authentication success.
- One representative request.
- Returned URL/title/content shape.
- Rate-limit headers where available.
- Latency and billed usage.
- Error behavior for an invalid request.
- Confirmation that keys and raw authorization headers do not appear in logs.

Smoke tests must use official vendor documentation or a neutral public test page. They must not research or overwrite ABB cells.

## Commercial and legal questions to settle before production

The PoC may proceed with ordinary developer terms, but production rollout requires explicit answers to:

1. May VentureX retain search results, short excerpts, and derived values?
2. May those excerpts appear in customer-facing reports?
3. What attribution is required?
4. Is customer venture context used for model or product training?
5. Is Zero Data Retention available, and on which plan?
6. What data-processing agreement, SLA, and incident-notification terms are available?
7. Are there geography or data-residency restrictions?
8. Can VentureX impose organization-level spend and rate limits?

These answers matter before the system processes confidential corporate-innovation briefs at enterprise scale.

## Exit criteria

This workstream is complete for the 3×10 experiment when:

- Exa, Brave, and Bright Data credentials are available through approved secret storage.
- SEC and GLEIF access have been verified.
- The selected plans permit the evidence retention required by the experiment.
- Spend caps and billing alerts are active.
- All providers required by the frozen ABB candidates pass smoke tests.
- Perplexity remains disabled by default and can run only through an explicit
  allowlisted post-pass.
- No secret has been committed to Git or exposed in logs.

## Live validation — 2026-07-13

The seven-call smoke suite produced the following result:

| Capability               | Result   | Follow-up                                                                                                    |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| Exa Search               | Pass     | None for PoC                                                                                                 |
| Exa Contents             | Pass     | None for PoC                                                                                                 |
| Brave Search             | Pass     | Confirm production storage/display rights                                                                    |
| GLEIF legal-name lookup  | Pass     | No key is required                                                                                           |
| Bright Data Web Unlocker | Pass     | Clean ABB run used it for 8 fallback fetches                                                                 |
| SEC EDGAR                | Pass     | Clean ABB run made 12 SEC calls                                                                              |
| Companies House          | Deferred | Current key is not valid for the live API; no frozen ABB candidate is UK-based, so this is not a PoC blocker |

Perplexity is configured but remained disabled. Clean ABB run
`72a9b395-7c7c-4cb2-b9ce-c2d5a91141c0` made zero Perplexity and Companies
House calls, completed all 30 cells with zero operational errors, and exercised
both Bright Data and SEC successfully.

The later authorized post-pass made seven valid Perplexity research
completions on seven approved unknown cells. One earlier request failed before
billing and was retried in a new audit-linked run. The post-pass improved one
cell, upheld six unknowns, cost $3.3723 all-in incrementally, and left canonical
cells unchanged. The final run is `60092d5e-c537-4c96-85ba-cf71d1723efc`.

Security follow-up: the InsForge CLI's `current --json` command echoed the
direct-link backend API key into the private development task output while the
migration context was being verified. The key was not committed or copied into
an artifact, but it should be rotated and the CLI re-linked before production.
Avoid `current --json` for future context checks until the CLI redacts that
field.

## Handoff to engineering

The active PoC service handoff is complete. Companies House is the only
deferred adapter and should be revisited before the first UK-company case.
