import type {
  InvestorReportCandidate,
  InvestorReportCitation,
  InvestorReportData,
  InvestorReportWeight,
} from "@/lib/investor-report-data";
import {
  CANDIDATE_TYPE_LABELS,
  formatDate,
  formatScore,
  makeCellKey,
  type ComparisonCell,
} from "@/lib/table-viewer";
import type { Dimension } from "@/types/venture-profile";

const DIMENSION_LABELS: Record<Dimension, string> = {
  product_solution: "Product & solution",
  customers: "Customers",
  transaction: "Transaction model",
  partners: "Partners",
  access: "Market access",
  geography_regulatory: "Geography & regulation",
  capital_asset: "Capital & assets",
};

const TIER_NAMES = {
  1: "Foundational",
  2: "Framework",
  3: "Venture-specific",
} as const;

interface SourceEntry {
  number: number;
  url: string;
  title: string;
  context: string | null;
}

class SourceRegistry {
  private readonly byUrl = new Map<string, SourceEntry>();

  add(
    citation: InvestorReportCitation | ComparisonCell["citations"][number],
  ): number {
    const current = this.byUrl.get(citation.url);
    if (current) return current.number;

    const isCandidateCitation = "title" in citation;
    const entry: SourceEntry = {
      number: this.byUrl.size + 1,
      url: citation.url,
      title: isCandidateCitation
        ? citation.title
        : citation.source_title || citation.url,
      context: isCandidateCitation ? citation.query : citation.snippet || null,
    };
    this.byUrl.set(citation.url, entry);
    return entry.number;
  }

  entries(): SourceEntry[] {
    return [...this.byUrl.values()];
  }
}

export function buildInvestorReportHtml(
  data: InvestorReportData,
  exportedAt = new Date().toISOString(),
): string {
  const sources = new SourceRegistry();
  const cellsByKey = new Map<string, ComparisonCell>();
  for (const cell of data.cells) {
    cellsByKey.set(makeCellKey(cell.candidate_id, cell.parameter_key), cell);
  }

  // Register in reading order so source numbering remains deterministic.
  for (const candidate of data.candidates) {
    for (const citation of candidate.citations) sources.add(citation);
  }
  for (const parameter of data.parameters) {
    for (const candidate of data.candidates) {
      const cell = cellsByKey.get(
        makeCellKey(candidate.candidate_id, parameter.parameter_key),
      );
      for (const citation of cell?.citations ?? []) sources.add(citation);
    }
  }

  const sourceEntries = sources.entries();
  const title = `${data.venture.title} competitive landscape`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} | VentureX</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="screen-actions">
    <span>Investor report · 3 × 10 focused edition</span>
    <button type="button" onclick="window.print()">Print / save as PDF</button>
  </div>
  <main class="report-shell">
    ${renderCover(data, exportedAt)}
    ${renderProfile(data)}
    ${renderWeighting(data.weights)}
    ${renderRankedCandidates(data.candidates, data.weights, sources)}
    ${renderAppendix(data, cellsByKey, sources)}
    ${renderSources(sourceEntries)}
  </main>
</body>
</html>`;
}

export function investorReportFilename(data: InvestorReportData): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `venturex_${data.venture.slug}_landscape_${stamp}.html`;
}

function renderCover(data: InvestorReportData, exportedAt: string): string {
  const scored = data.candidates.filter(
    (candidate) => typeof candidate.aggregate_score === "number",
  );
  const leader = scored[0];
  const coverage = data.cells.filter(
    (cell) => cell.confidence !== "unknown",
  ).length;
  const coveragePercent = data.cells.length
    ? Math.round((coverage / data.cells.length) * 100)
    : 0;

  return `<section class="page cover-page">
    <header class="report-header">
      <div class="wordmark"><span>V</span> VentureX</div>
      <div class="eyebrow">Competitive landscape · Decision brief</div>
    </header>
    <div class="cover-hero">
      <div class="kicker">Focused landscape / ${escapeHtml(formatDate(exportedAt))}</div>
      <h1>${escapeHtml(data.venture.title)}</h1>
      <p class="cover-thesis">${escapeHtml(data.profile.synthetic_description)}</p>
    </div>
    <div class="cover-metrics">
      <div><strong>${data.candidates.length}</strong><span>ranked competitors</span></div>
      <div><strong>${data.parameters.length}</strong><span>decision parameters</span></div>
      <div><strong>${coveragePercent}%</strong><span>evidenced matrix</span></div>
      <div><strong>${leader?.aggregate_score != null ? formatScore(leader.aggregate_score) : "—"}</strong><span>leading weighted score / 5</span></div>
    </div>
    <aside class="cover-note">
      <div>
        <span class="section-number">Scope</span>
        <p>This focused edition presents the three highest-ranked companies and a ten-parameter, mixed-difficulty evidence set drawn from a source landscape of ${data.source_counts.candidates} companies and ${data.source_counts.parameters} parameters.</p>
      </div>
      <div>
        <span class="section-number">Method</span>
        <p>Competitors are ranked on a 1–5 weighted aggregate across seven dimensions. The appendix balances foundational, framework, and venture-specific research rather than taking the first available fields.</p>
      </div>
    </aside>
    <footer class="page-footer"><span>Prepared with VentureX</span><span>Confidential · working analysis</span></footer>
  </section>`;
}

function renderProfile(data: InvestorReportData): string {
  const { profile } = data;
  const product = profile.dimensions.product_solution;
  const customers = profile.dimensions.customers;
  const transaction = profile.dimensions.transaction;
  const geography = profile.dimensions.geography_regulatory;
  const capital = profile.dimensions.capital_asset;

  return `<section class="page content-page">
    ${sectionHeader("01", "Venture profile", "The opportunity the landscape is being measured against")}
    <div class="profile-lead">
      <div class="profile-statement">
        <span class="label">Job to be done</span>
        <p>${escapeHtml(product.job_to_be_done)}</p>
      </div>
      <div class="profile-statement accent-statement">
        <span class="label">Intended end state</span>
        <p>${escapeHtml(profile.intended_end_state.scale)}</p>
        <small>${escapeHtml(String(profile.intended_end_state.timeline_years))}-year horizon · ${escapeHtml(profile.current_maturity.replace(/_/g, " "))}</small>
      </div>
    </div>
    <div class="profile-grid">
      ${profileCard("Solution", product.solution_mechanism, product.platform_or_pipe)}
      ${profileCard("Buyer", customers.buyer, `${customers.segment_type} · ${customers.buyer_sophistication} sophistication`)}
      ${profileCard("Economics", humanize(transaction.model), `${transaction.typical_deal_size_usd} · ${humanize(transaction.revenue_recurrence)}`)}
      ${profileCard("Geography", geography.target_geographies.join(", "), `${geography.regulatory_regime} regulatory regime`)}
      ${profileCard("Asset posture", humanize(capital.asset_type), `${humanize(capital.capital_intensity)} capital intensity`)}
      ${profileCard("Defensibility", capital.defensibility_model, `${capital.time_to_revenue_years} years to revenue`)}
    </div>
    <div class="risk-block">
      <div>
        <span class="label">Success threshold</span>
        <p>${escapeHtml(profile.intended_end_state.minimum_success_criteria)}</p>
      </div>
      <div>
        <span class="label">Questions the landscape must answer</span>
        <ol>${profile.strategic_risks_and_uncertainties
          .map((risk) => `<li>${escapeHtml(risk.risk)}</li>`)
          .join("")}</ol>
      </div>
    </div>
    ${pageFooter(data.venture.title, "Venture profile")}
  </section>`;
}

function renderWeighting(weights: InvestorReportWeight[]): string {
  const ordered = [...weights].sort((a, b) => b.weight - a.weight);
  const topThree = ordered
    .slice(0, 3)
    .reduce((sum, item) => sum + item.weight, 0);

  return `<section class="page content-page">
    ${sectionHeader("02", "Weighted decision lens", "Why some forms of competitive overlap matter more than others")}
    <div class="lens-summary">
      <div><strong>${Math.round(topThree * 100)}%</strong><span>of the decision weight sits in the top three dimensions</span></div>
      <p>The aggregate is a prioritization device, not a claim of false precision. Each score is tied to researched cells and an explicit dimension rationale.</p>
    </div>
    <div class="weight-list">
      ${ordered.map((weight, index) => renderWeight(weight, index + 1)).join("")}
    </div>
    <div class="method-note"><strong>Scoring convention.</strong> 1 = no meaningful overlap; 3 = material but incomplete overlap; 5 = near-direct competitive overlap. Dimension weights sum to approximately 100%.</div>
    ${pageFooter("VentureX methodology", "Weighted decision lens")}
  </section>`;
}

function renderRankedCandidates(
  candidates: InvestorReportCandidate[],
  weights: InvestorReportWeight[],
  sources: SourceRegistry,
): string {
  return `<section class="page content-page ranking-page">
    ${sectionHeader("03", "Ranked competitors", "The three companies that matter most to the venture thesis")}
    <div class="rank-list">
      ${candidates
        .map((candidate, index) =>
          renderRankedCandidate(candidate, weights, sources, index === 0),
        )
        .join("")}
    </div>
    ${pageFooter("Weighted aggregate · 1–5", "Ranked competitors")}
  </section>`;
}

function renderRankedCandidate(
  candidate: InvestorReportCandidate,
  weights: InvestorReportWeight[],
  sources: SourceRegistry,
  leader: boolean,
): string {
  const type = candidate.candidate_type
    ? (CANDIDATE_TYPE_LABELS[candidate.candidate_type] ??
      candidate.candidate_type)
    : "Competitive candidate";
  const sourceLinks = candidate.citations
    .map((citation) => sourceReference(sources.add(citation)))
    .join("");
  const signals = scoreSignals(candidate, weights);

  return `<article class="rank-card${leader ? " leader" : ""}">
    <div class="rank-identity">
      ${renderLogo(candidate)}
      <div>
        <span class="rank-overline">#${candidate.rank ?? "—"} · ${escapeHtml(type)}</span>
        <h3>${escapeHtml(candidate.name)}</h3>
      </div>
      <div class="score-lockup"><strong>${candidate.aggregate_score != null ? formatScore(candidate.aggregate_score) : "—"}</strong><span>/ 5 weighted</span></div>
    </div>
    <div class="why-matters"><span class="label">Why it matters</span><p>${escapeHtml(candidate.rationale)}${sourceLinks}</p></div>
    <div class="score-signals">
      ${
        signals.length > 0
          ? signals
              .map(
                (signal) =>
                  `<div><span>${escapeHtml(signal.label)} · ${signal.score}/5</span><p>${escapeHtml(signal.rationale)}</p></div>`,
              )
              .join("")
          : `<div><span>Scoring detail</span><p>Per-dimension scoring has not been completed for this candidate.</p></div>`
      }
    </div>
  </article>`;
}

function renderAppendix(
  data: InvestorReportData,
  cellsByKey: Map<string, ComparisonCell>,
  sources: SourceRegistry,
): string {
  const tierCounts = ([1, 2, 3] as const).map((tier) => ({
    tier,
    count: data.parameters.filter((parameter) => parameter.tier === tier)
      .length,
  }));

  return `<section class="page appendix-page">
    ${sectionHeader("A", "Evidence matrix", "Complete 3 × 10 focused appendix")}
    <div class="appendix-intro">
      <p>Ten parameters were sampled across the research stack and spread across each tier's schema—not selected for convenience. Values retain their evidence confidence and source references.</p>
      <div class="tier-legend">
        ${tierCounts
          .map(
            ({ tier, count }) =>
              `<span data-tier="${tier}"><b>${count}</b> ${TIER_NAMES[tier]}</span>`,
          )
          .join("")}
      </div>
    </div>
    <table class="matrix-table">
      <thead><tr>
        <th>Parameter</th>
        ${data.candidates
          .map(
            (candidate) =>
              `<th><div class="matrix-company">${renderLogo(candidate, true)}<span><b>#${candidate.rank ?? "—"}</b>${escapeHtml(candidate.name)}</span></div></th>`,
          )
          .join("")}
      </tr></thead>
      <tbody>
        ${data.parameters
          .map(
            (parameter) => `<tr>
              <th><span class="tier-chip" data-tier="${parameter.tier}">T${parameter.tier}</span><b>${escapeHtml(parameter.parameter_label)}</b><small>${escapeHtml(parameter.description)}</small></th>
              ${data.candidates
                .map((candidate) => {
                  const cell = cellsByKey.get(
                    makeCellKey(
                      candidate.candidate_id,
                      parameter.parameter_key,
                    ),
                  );
                  return renderMatrixCell(
                    cell,
                    parameter.parameter_key,
                    sources,
                  );
                })
                .join("")}
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    ${pageFooter("3 companies × 10 mixed-difficulty parameters", "Evidence matrix")}
  </section>`;
}

function renderSources(entries: SourceEntry[]): string {
  return `<section class="page sources-page">
    ${sectionHeader("B", "Sources & notes", "Evidence referenced in the focused report")}
    ${
      entries.length > 0
        ? `<ol class="source-list">${entries
            .map(
              (entry) =>
                `<li id="source-${entry.number}" value="${entry.number}"><a href="${escapeAttribute(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}</a><span>${escapeHtml(entry.url)}</span>${entry.context ? `<p>${escapeHtml(entry.context)}</p>` : ""}</li>`,
            )
            .join("")}</ol>`
        : `<div class="empty-sources">No source links were attached to the selected evidence cells.</div>`
    }
    <div class="disclaimer"><strong>Interpretation note.</strong> Verified values are directly supported by a cited source. Inferred values synthesize available evidence and should be treated as directional. Unknown values represent a research gap, not evidence of absence.</div>
    ${pageFooter("Confidential · working analysis", "Sources & notes")}
  </section>`;
}

function renderMatrixCell(
  cell: ComparisonCell | undefined,
  parameterKey: string,
  sources: SourceRegistry,
): string {
  if (!cell) {
    return `<td><span class="confidence unknown">Not researched</span><p class="empty-value">No evidence captured.</p></td>`;
  }

  const references = cell.citations
    .map((citation) => sourceReference(sources.add(citation)))
    .join("");
  const reason =
    cell.confidence === "unknown" && cell.reason
      ? `<p class="cell-reason">${escapeHtml(cell.reason)}</p>`
      : "";
  return `<td>
    <span class="confidence ${cell.confidence}">${escapeHtml(cell.confidence)}</span>
    <div class="cell-value">${renderValue(cell.value, parameterKey)}${references}</div>
    ${reason}
  </td>`;
}

function renderValue(value: unknown, parameterKey?: string): string {
  if (value == null || value === "")
    return `<span class="empty-value">Not available</span>`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return parameterKey === "founded_year"
      ? String(value)
      : new Intl.NumberFormat("en-US").format(value);
  }
  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) {
    if (value.length === 0)
      return `<span class="empty-value">None disclosed</span>`;
    return `<ul class="value-list">${value
      .map((item) => `<li>${renderValue(item, parameterKey)}</li>`)
      .join("")}</ul>`;
  }
  if (typeof value === "object") {
    return `<dl class="value-object">${Object.entries(
      value as Record<string, unknown>,
    )
      .map(
        ([key, entry]) =>
          `<div><dt>${escapeHtml(humanize(key))}</dt><dd>${renderValue(entry, parameterKey)}</dd></div>`,
      )
      .join("")}</dl>`;
  }
  return escapeHtml(String(value));
}

function renderWeight(weight: InvestorReportWeight, position: number): string {
  const percent = Math.round(weight.weight * 100);
  return `<article class="weight-row">
    <div class="weight-rank">${String(position).padStart(2, "0")}</div>
    <div class="weight-copy"><div><h3>${escapeHtml(DIMENSION_LABELS[weight.dimension])}</h3><strong>${percent}%</strong></div><p>${escapeHtml(weight.rationale)}</p></div>
    <div class="weight-track"><span style="width:${Math.min(100, percent)}%"></span></div>
  </article>`;
}

function renderLogo(
  candidate: Pick<InvestorReportCandidate, "name" | "logo_url">,
  compact = false,
): string {
  const initial = candidate.name.trim().slice(0, 1).toUpperCase() || "V";
  const image = candidate.logo_url
    ? `<img src="${escapeAttribute(candidate.logo_url)}" alt="" onerror="this.style.display='none'">`
    : "";
  return `<span class="company-logo${compact ? " compact" : ""}" aria-hidden="true"><b>${escapeHtml(initial)}</b>${image}</span>`;
}

function scoreSignals(
  candidate: InvestorReportCandidate,
  weights: InvestorReportWeight[],
): Array<{ label: string; score: number; rationale: string }> {
  if (!candidate.dimension_scores) return [];
  const weightByDimension = new Map(
    weights.map((weight) => [weight.dimension, weight.weight]),
  );
  return Object.entries(candidate.dimension_scores)
    .map(([dimension, score]) => ({
      dimension: dimension as Dimension,
      score: score.score,
      rationale: score.rationale,
      contribution:
        score.score * (weightByDimension.get(dimension as Dimension) ?? 0),
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((item) => ({
      label: DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension),
      score: item.score,
      rationale: item.rationale,
    }));
}

function profileCard(title: string, value: string, meta: string): string {
  return `<article><span class="label">${escapeHtml(title)}</span><p>${escapeHtml(value)}</p><small>${escapeHtml(meta)}</small></article>`;
}

function sectionHeader(
  number: string,
  title: string,
  subtitle: string,
): string {
  return `<header class="section-header"><div class="section-number">${escapeHtml(number)}</div><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></header>`;
}

function pageFooter(left: string, right: string): string {
  return `<footer class="page-footer"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></footer>`;
}

function sourceReference(number: number): string {
  return `<sup class="source-ref"><a href="#source-${number}" aria-label="Source ${number}">${number}</a></sup>`;
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const REPORT_CSS = `
:root {
  --ink: #14241f;
  --ink-soft: #43524d;
  --paper: #fffdf8;
  --canvas: #e9e5dc;
  --line: #d8d2c7;
  --mist: #f3f0e9;
  --green: #1f6b50;
  --green-dark: #113f31;
  --lime: #b8d891;
  --gold: #b98238;
  --blue: #44738b;
}
* { box-sizing: border-box; }
html { background: var(--canvas); color: var(--ink); }
body { margin: 0; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.55; }
a { color: inherit; }
.screen-actions { position: relative; z-index: 20; display: flex; align-items: center; justify-content: space-between; max-width: 1120px; margin: 0 auto; padding: 12px 4px; color: var(--ink-soft); font-size: 12px; }
.screen-actions button { border: 0; border-radius: 999px; padding: 10px 16px; background: var(--green-dark); color: #fff; font: inherit; font-weight: 700; cursor: pointer; box-shadow: 0 8px 22px rgba(17,63,49,.18); }
.report-shell { width: min(100% - 32px, 1120px); margin: 0 auto 72px; }
.page { position: relative; min-height: 780px; margin: 0 0 24px; padding: 56px 62px 52px; overflow: visible; background: var(--paper); box-shadow: 0 18px 60px rgba(20,36,31,.1); }
.cover-page { min-height: 880px; display: flex; flex-direction: column; overflow: hidden; background: var(--green-dark); color: #f7f5ed; }
.cover-page::after { content: ""; position: absolute; width: 520px; height: 520px; right: -180px; bottom: -220px; border: 1px solid rgba(184,216,145,.28); border-radius: 50%; box-shadow: 0 0 0 90px rgba(184,216,145,.04), 0 0 0 180px rgba(184,216,145,.025); }
.report-header { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1; }
.wordmark { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.wordmark span { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--lime); border-radius: 50%; color: var(--lime); font-family: Georgia, serif; font-size: 17px; }
.eyebrow, .kicker, .label, .rank-overline { font-size: 10px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.eyebrow { color: rgba(247,245,237,.62); }
.cover-hero { position: relative; z-index: 1; margin-top: 120px; max-width: 850px; }
.kicker { color: var(--lime); }
.cover-hero h1 { margin: 16px 0 22px; max-width: 780px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(52px, 7vw, 82px); line-height: .98; font-weight: 400; letter-spacing: -.045em; }
.cover-thesis { max-width: 820px; margin: 0; color: rgba(247,245,237,.78); font-family: Georgia, "Times New Roman", serif; font-size: 19px; line-height: 1.58; }
.cover-metrics { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin-top: 70px; border: 1px solid rgba(247,245,237,.15); background: rgba(247,245,237,.15); }
.cover-metrics div { padding: 22px; background: var(--green-dark); }
.cover-metrics strong { display: block; font-family: Georgia, serif; color: var(--lime); font-size: 34px; font-weight: 400; line-height: 1; }
.cover-metrics span { display: block; margin-top: 9px; color: rgba(247,245,237,.58); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.cover-note { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: auto; padding-top: 44px; max-width: 880px; }
.cover-note p { margin: 8px 0 0; color: rgba(247,245,237,.65); font-size: 12px; }
.cover-note .section-number { color: var(--lime); }
.page-footer { position: absolute; left: 62px; right: 62px; bottom: 24px; z-index: 2; display: flex; justify-content: space-between; padding-top: 11px; border-top: 1px solid var(--line); color: #77827e; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.cover-page .page-footer { border-color: rgba(247,245,237,.16); color: rgba(247,245,237,.42); }
.section-header { display: grid; grid-template-columns: 46px 1fr; gap: 18px; align-items: start; padding-bottom: 23px; border-bottom: 1px solid var(--line); }
.section-number { color: var(--green); font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.section-header h2 { margin: -7px 0 2px; font-family: Georgia, "Times New Roman", serif; font-size: 38px; line-height: 1.1; font-weight: 400; letter-spacing: -.025em; }
.section-header p { margin: 0; color: var(--ink-soft); font-size: 12px; }
.profile-lead { display: grid; grid-template-columns: 1.35fr 1fr; gap: 28px; margin: 38px 0 26px; }
.profile-statement { padding: 25px 26px; border: 1px solid var(--line); }
.profile-statement p { margin: 10px 0 0; font-family: Georgia, serif; font-size: 18px; line-height: 1.45; }
.profile-statement small, .profile-grid small { display: block; margin-top: 10px; color: var(--ink-soft); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.accent-statement { border: 0; background: var(--green-dark); color: #fff; }
.accent-statement .label, .accent-statement small { color: var(--lime); }
.label { color: var(--green); }
.profile-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.profile-grid article { min-height: 135px; padding: 20px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.profile-grid p { margin: 10px 0 0; font-size: 14px; font-weight: 650; line-height: 1.4; }
.risk-block { display: grid; grid-template-columns: .75fr 1.25fr; gap: 34px; margin-top: 27px; padding: 26px 28px; background: var(--mist); }
.risk-block p { margin: 9px 0 0; font-family: Georgia, serif; font-size: 16px; line-height: 1.45; }
.risk-block ol { margin: 9px 0 0; padding-left: 20px; color: var(--ink-soft); font-size: 11px; }
.risk-block li + li { margin-top: 5px; }
.lens-summary { display: grid; grid-template-columns: 220px 1fr; gap: 42px; align-items: center; margin: 34px 0 28px; padding: 24px 28px; background: var(--mist); }
.lens-summary div { display: flex; align-items: center; gap: 14px; }
.lens-summary strong { font-family: Georgia, serif; font-size: 38px; font-weight: 400; color: var(--green); }
.lens-summary span { font-size: 10px; line-height: 1.35; text-transform: uppercase; letter-spacing: .06em; }
.lens-summary p { margin: 0; color: var(--ink-soft); font-family: Georgia, serif; font-size: 15px; }
.weight-list { border-top: 1px solid var(--line); }
.weight-row { display: grid; grid-template-columns: 38px 1fr 160px; gap: 17px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
.weight-rank { color: #98a19e; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.weight-copy > div { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; }
.weight-copy h3 { margin: 0; font-size: 13px; }
.weight-copy strong { color: var(--green); font-size: 13px; }
.weight-copy p { margin: 3px 0 0; color: var(--ink-soft); font-size: 10.5px; line-height: 1.4; }
.weight-track { height: 5px; overflow: hidden; background: #e5e1d8; }
.weight-track span { display: block; height: 100%; background: var(--green); }
.method-note, .disclaimer { margin-top: 24px; padding-left: 16px; border-left: 3px solid var(--lime); color: var(--ink-soft); font-size: 10.5px; }
.rank-list { display: grid; gap: 14px; margin-top: 31px; }
.rank-card { padding: 22px 24px; border: 1px solid var(--line); break-inside: avoid; }
.rank-card.leader { border-color: var(--green-dark); background: var(--green-dark); color: #fff; }
.rank-identity { display: grid; grid-template-columns: 52px 1fr auto; gap: 15px; align-items: center; }
.company-logo { position: relative; display: grid; place-items: center; width: 50px; height: 50px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); color: var(--green-dark); }
.company-logo b { font-family: Georgia, serif; font-size: 22px; }
.company-logo img { position: absolute; inset: 0; width: 100%; height: 100%; padding: 7px; object-fit: contain; background: #fff; }
.company-logo.compact { width: 28px; height: 28px; border-radius: 7px; }
.company-logo.compact b { font-size: 13px; }
.company-logo.compact img { padding: 4px; }
.rank-overline { color: var(--green); }
.leader .rank-overline { color: var(--lime); }
.rank-card h3 { margin: 2px 0 0; font-family: Georgia, serif; font-size: 25px; font-weight: 400; }
.score-lockup { text-align: right; }
.score-lockup strong { display: block; font-family: Georgia, serif; color: var(--green); font-size: 31px; line-height: 1; font-weight: 400; }
.leader .score-lockup strong { color: var(--lime); }
.score-lockup span { color: var(--ink-soft); font-size: 9px; letter-spacing: .05em; text-transform: uppercase; }
.leader .score-lockup span { color: rgba(255,255,255,.55); }
.why-matters { margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--line); }
.leader .why-matters { border-color: rgba(255,255,255,.18); }
.why-matters p { margin: 5px 0 0; font-family: Georgia, serif; font-size: 14px; line-height: 1.5; }
.leader .why-matters .label { color: var(--lime); }
.score-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 15px; }
.score-signals span { color: var(--green); font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.leader .score-signals span { color: var(--lime); }
.score-signals p { margin: 3px 0 0; color: var(--ink-soft); font-size: 9.5px; line-height: 1.4; }
.leader .score-signals p { color: rgba(255,255,255,.66); }
.source-ref { margin-left: 2px; font: 8px ui-monospace, monospace; }
.source-ref a { color: var(--green); text-decoration: none; }
.leader .source-ref a { color: var(--lime); }
.appendix-page { min-height: 720px; }
.appendix-intro { display: flex; justify-content: space-between; gap: 30px; margin: 24px 0 20px; }
.appendix-intro > p { max-width: 560px; margin: 0; color: var(--ink-soft); font-size: 11px; }
.tier-legend { display: flex; align-items: flex-start; gap: 6px; }
.tier-legend span { padding: 5px 7px; border: 1px solid var(--line); font-size: 8px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.tier-legend span[data-tier="1"] { border-top: 2px solid var(--green); }
.tier-legend span[data-tier="2"] { border-top: 2px solid var(--gold); }
.tier-legend span[data-tier="3"] { border-top: 2px solid var(--blue); }
.matrix-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; }
.matrix-table th, .matrix-table td { padding: 10px; border: 1px solid var(--line); vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.matrix-table thead th { background: var(--green-dark); color: #fff; }
.matrix-table thead th:first-child { width: 21%; }
.matrix-table tbody th { background: var(--mist); }
.matrix-table tbody th b { display: block; margin-top: 5px; font-size: 10px; line-height: 1.3; }
.matrix-table tbody th small { display: block; margin-top: 5px; color: var(--ink-soft); font-weight: 400; font-size: 8px; line-height: 1.35; }
.matrix-table tr { break-inside: avoid; }
.matrix-company { display: flex; align-items: center; gap: 8px; }
.matrix-company span { display: grid; line-height: 1.2; }
.matrix-company b { color: var(--lime); font-size: 8px; }
.tier-chip { display: inline-block; padding: 1px 4px; border-radius: 2px; background: var(--green); color: #fff; font-size: 7px; letter-spacing: .06em; }
.tier-chip[data-tier="2"] { background: var(--gold); }
.tier-chip[data-tier="3"] { background: var(--blue); }
.confidence { display: inline-block; margin-bottom: 5px; font-size: 7px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.confidence.verified { color: var(--green); }
.confidence.inferred { color: var(--gold); }
.confidence.unknown { color: #8d9692; }
.cell-value { line-height: 1.38; }
.cell-reason { margin: 5px 0 0; color: #8d5b35; font-size: 8px; }
.empty-value { color: #8d9692; font-style: italic; }
.value-list { margin: 0; padding-left: 13px; }
.value-list li + li { margin-top: 3px; }
.value-object { margin: 0; }
.value-object > div + div { margin-top: 4px; }
.value-object dt { color: #74807b; font-size: 7px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.value-object dd { margin: 0; }
.source-list { columns: 2; column-gap: 45px; margin: 32px 0 0; padding-left: 22px; }
.source-list li { margin: 0 0 17px; padding-left: 5px; break-inside: avoid; font-size: 10px; }
.source-list a { color: var(--green); font-weight: 700; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.source-list span { display: block; overflow-wrap: anywhere; color: #8a9490; font-size: 8px; }
.source-list p { margin: 3px 0 0; color: var(--ink-soft); font-size: 9px; }
.empty-sources { margin-top: 35px; padding: 30px; background: var(--mist); color: var(--ink-soft); }
@media (max-width: 800px) {
  .screen-actions { padding: 10px 16px; }
  .report-shell { width: 100%; }
  .page { min-height: 0; margin: 0; padding: 36px 24px 60px; box-shadow: none; }
  .cover-hero { margin-top: 70px; }
  .cover-metrics, .profile-grid { grid-template-columns: 1fr 1fr; }
  .profile-lead, .risk-block, .lens-summary { grid-template-columns: 1fr; }
  .weight-row { grid-template-columns: 28px 1fr; }
  .weight-track { grid-column: 2; }
  .page-footer { left: 24px; right: 24px; }
  .appendix-page { overflow-x: auto; }
  .matrix-table { min-width: 880px; }
}
@page { size: Letter portrait; margin: .35in; }
@page appendix { size: Letter landscape; margin: .28in; }
@media print {
  :root { --canvas: #fff; }
  html, body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .screen-actions { display: none; }
  .report-shell { width: auto; margin: 0; }
  .page { width: auto; min-height: 9.95in; margin: 0; padding: .45in .5in .42in; overflow: hidden; box-shadow: none; break-after: page; }
  .appendix-page { page: appendix; min-height: 7.35in; padding: .36in .38in .38in; }
  .page-footer { left: .5in; right: .5in; bottom: .16in; }
  .appendix-page .page-footer { left: .38in; right: .38in; }
  .source-list a { text-decoration: none; }
}
`;
