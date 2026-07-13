# Cell Research Improvement — Service Setup Workstream

Status: credentials supplied; live validation partially complete  
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
- Official public APIs, beginning with SEC EDGAR, GLEIF, and Companies House.

### “Yes, but later”

- Perplexity Sonar Deep Research as the big-gun fallback.
- AlphaSense, PitchBook, Factiva, or similar premium content/data platforms.
- Bright Data Browser API or residential proxy products.
- Paid global company registries unless the official/free route proves inadequate.

The first implementation may define a disabled Perplexity adapter and environment variables, but it must not make Perplexity calls or require a Perplexity account to complete the experiment.

## Provisioning decisions

| Service | Initial product | Why we need it | Initial spend posture | Credential / configuration |
|---|---|---|---|---|
| Exa | Search + Contents | Semantic discovery, related pages, full text and PDF extraction | Keep the smallest paid plan that supplies the required rate limits; set a monthly cap | `EXA_API_KEY` |
| Brave | Search API | Independent lexical/news index; reduces dependence on Exa’s ranking and recall | Start with Search rather than Answers; usage is tiny for 3×10 | `BRAVE_SEARCH_API_KEY` |
| Bright Data | Web Unlocker API | Fetch public pages that normal HTTP or Exa cannot reliably retrieve because of blocking or rendering | Free tier or pay-as-you-go; do not buy Browser API yet | `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_ZONE` |
| SEC EDGAR | Public REST APIs | US public-company identity, filings, financial facts, and recent 8-K/10-K/10-Q evidence | Free; no API key | `SEC_USER_AGENT` |
| GLEIF | Public API | Legal entity names, identifiers, addresses, and ownership relationships | Free; no API key | None |
| Companies House | Public API | Live UK company and officer data | Free; account and API key required | `COMPANIES_HOUSE_API_KEY` |
| Perplexity | Sonar Deep Research | Future escalation for genuinely hard, multi-step research | Disabled in phase 1 | `PERPLEXITY_API_KEY` only when activated |

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
- [ ] Create a Companies House account, application, and API key.
- [ ] Confirm SEC and GLEIF require no credentials and are reachable from the deployed environment.
- [ ] Provide a general operations email for API-contact and rate-limit notices.
- [ ] Do not purchase OpenCorporates or another registry yet; list countries where official access is inadequate and revisit after the 3×10 test.

### 5. Perplexity placeholder

- [ ] No signup is required for phase 1.
- [ ] When activated later, create a separate budget-controlled API project.
- [ ] Do not add a usable key until the code path has a hard per-run cap, explicit user authorization, and complete logging.

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

# Deliberately disabled during phase 1
PERPLEXITY_API_KEY=
CELL_RESEARCH_PERPLEXITY_ENABLED=false
```

Engineering will add blank, documented entries to `.env.example`; no real values belong there. Production credentials should be entered directly in the deployment platform’s secret manager.

## Service register

Fill this table without including secret values.

| Service | Account owner | Project / zone | Plan | Monthly cap | Rate limit | Storage/display rights confirmed | Ready |
|---|---|---|---|---:|---|---|---|
| Exa |  |  |  |  |  |  | ☐ |
| Brave |  |  |  |  |  |  | ☐ |
| Bright Data |  |  |  |  |  |  | ☐ |
| Companies House |  |  | Free | 0 |  | Public-data terms reviewed | ☐ |
| SEC |  | N/A | Free | 0 | Published fair-access limits | Public-data terms reviewed | ☐ |
| GLEIF |  | N/A | Free | 0 |  | Public-data terms reviewed | ☐ |

## Budget guardrails for the experiment

- Soft target: **under $5 total external-provider and model cost** for the new 30-cell run.
- Hard stop: **$10 for the run** without explicit authorization.
- No provider may retry indefinitely.
- Bright Data is a fetch fallback, not the default route for every URL.
- Perplexity is disabled.
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

- Exa, Brave, Bright Data, and Companies House credentials are available through approved secret storage.
- SEC and GLEIF access have been verified.
- The selected plans permit the evidence retention required by the experiment.
- Spend caps and billing alerts are active.
- Provider smoke tests pass.
- Perplexity remains disabled.
- No secret has been committed to Git or exposed in logs.

## Live validation — 2026-07-12

The seven-call smoke suite produced the following result:

| Capability | Result | Follow-up |
|---|---|---|
| Exa Search | Pass | None for PoC |
| Exa Contents | Pass | None for PoC |
| Brave Search | Pass | Confirm production storage/display rights |
| GLEIF legal-name lookup | Pass | No key is required |
| Bright Data Web Unlocker | Configuration failure | The configured `venturex_research` zone does not exist; create the zone or set `BRIGHT_DATA_ZONE` to the actual Web Unlocker zone name |
| SEC EDGAR | Configuration failure | Replace the template `SEC_USER_AGENT` with `VentureX research <real operations email>`; no SEC key is required |
| Companies House | Authentication failure | The API returned HTTP 401; confirm this is a live Companies House REST API key, that the application is active, and that the complete key was copied |

Perplexity is configured but remained disabled. The ABB run made zero
Perplexity calls. Bright Data and the failed official adapters failed soft and
did not cause an unbounded paid fallback.

Security follow-up: the InsForge CLI's `current --json` command echoed the
direct-link backend API key into the private development task output while the
migration context was being verified. The key was not committed or copied into
an artifact, but it should be rotated and the CLI re-linked before production.
Avoid `current --json` for future context checks until the CLI redacts that
field.

## Handoff to engineering

Engineering can start before this checklist is complete. Provider adapters, policies, schemas, tests, and recorded fixtures must be buildable against mocks. Live integration is blocked only at the smoke-test and live-comparison steps.
