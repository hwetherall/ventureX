import { promises as fs } from "node:fs";
import path from "node:path";

interface EvidenceItem {
  provider?: unknown;
  url?: unknown;
  title?: unknown;
  source_class?: unknown;
  excerpt?: unknown;
  disposition?: unknown;
}

interface ComparisonRow {
  candidate: string;
  parameter_key: string;
  v2: Record<string, unknown> & { evidence?: EvidenceItem[] };
}

interface ComparisonFile {
  run_id: string;
  rows: ComparisonRow[];
}

interface DeltaRow {
  candidate: string;
  parameterKey: string;
  before: ComparisonRow["v2"];
  after: ComparisonRow["v2"];
  incrementalCostUsd: number;
  newEvidence: EvidenceItem[];
}

const LABELS: Record<string, string> = {
  headcount: "Headcount",
  sales_cycle_length: "Sales-cycle length",
  server_oem_integrator_relationships: "Server OEM / integrator relationships",
  hyperscaler_reference_wins: "Hyperscaler reference wins",
};

async function main() {
  const [beforeArg, afterArg, outputArg] = process.argv.slice(2);
  if (!beforeArg || !afterArg) {
    throw new Error(
      "Usage: tsx scripts/compare-cell-research-postpass.mts <first-pass-comparison.json> <post-pass-comparison.json> [output-directory]",
    );
  }
  const beforePath = path.resolve(beforeArg);
  const afterPath = path.resolve(afterArg);
  const before = JSON.parse(
    await fs.readFile(beforePath, "utf8"),
  ) as ComparisonFile;
  const after = JSON.parse(
    await fs.readFile(afterPath, "utf8"),
  ) as ComparisonFile;
  const beforeByKey = new Map(before.rows.map((row) => [key(row), row]));
  const deltas = after.rows.flatMap((row) => {
    const prior = beforeByKey.get(key(row));
    if (!prior || !changed(prior.v2, row.v2)) return [];
    const priorUrls = new Set(evidence(prior.v2).map(urlFor));
    return [
      {
        candidate: row.candidate,
        parameterKey: row.parameter_key,
        before: prior.v2,
        after: row.v2,
        incrementalCostUsd: number(row.v2.cost_usd) - number(prior.v2.cost_usd),
        newEvidence: evidence(row.v2).filter(
          (item) => !priorUrls.has(urlFor(item)),
        ),
      },
    ];
  });
  const outputDir = path.resolve(outputArg ?? path.dirname(afterPath));
  await fs.mkdir(outputDir, { recursive: true });
  const payload = {
    first_pass_run_id: before.run_id,
    post_pass_run_id: after.run_id,
    generated_at: new Date().toISOString(),
    escalated_cells: deltas.length,
    incremental_cost_usd: deltas.reduce(
      (sum, row) => sum + row.incrementalCostUsd,
      0,
    ),
    confidence_improvements: deltas.filter(
      (row) =>
        confidenceRank(String(row.after.final_confidence)) >
        confidenceRank(String(row.before.final_confidence)),
    ).length,
    rows: deltas,
  };
  await fs.writeFile(
    path.join(outputDir, "perplexity-delta.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputDir, "perplexity-delta.csv"),
    makeCsv(deltas),
  );
  await fs.writeFile(
    path.join(outputDir, "perplexity-delta.html"),
    makeHtml(before.run_id, after.run_id, deltas),
  );
  console.log(
    `Wrote ${deltas.length} first-pass -> Perplexity deltas to ${outputDir}`,
  );
}

function makeCsv(rows: DeltaRow[]): string {
  const lines = [
    [
      "candidate",
      "parameter",
      "first_pass_confidence",
      "post_pass_confidence",
      "post_pass_value",
      "incremental_cost_usd",
      "new_evidence_count",
      "post_pass_reason",
    ],
    ...rows.map((row) => [
      row.candidate,
      row.parameterKey,
      String(row.before.final_confidence ?? ""),
      String(row.after.final_confidence ?? ""),
      JSON.stringify(row.after.value ?? null),
      row.incrementalCostUsd.toFixed(6),
      String(row.newEvidence.length),
      String(row.after.reason ?? ""),
    ]),
  ];
  return `${lines.map((line) => line.map(csv).join(",")).join("\r\n")}\r\n`;
}

function makeHtml(
  beforeRunId: string,
  afterRunId: string,
  rows: DeltaRow[],
): string {
  const totalCost = rows.reduce((sum, row) => sum + row.incrementalCostUsd, 0);
  const improved = rows.filter(
    (row) =>
      confidenceRank(String(row.after.final_confidence)) >
      confidenceRank(String(row.before.final_confidence)),
  ).length;
  const upheldUnknown = rows.filter(
    (row) =>
      row.before.final_confidence === "unknown" &&
      row.after.final_confidence === "unknown",
  ).length;
  const cards = rows
    .map((row) => {
      const afterConfidence = String(row.after.final_confidence ?? "unknown");
      const value =
        row.after.value == null
          ? "No accepted value"
          : JSON.stringify(row.after.value);
      const sources = row.newEvidence
        .map(
          (item) =>
            `<li><a href="${html(urlFor(item))}">${html(String(item.title ?? item.url ?? "Source"))}</a><span>${html(String(item.provider ?? ""))} · ${html(String(item.source_class ?? ""))}</span></li>`,
        )
        .join("");
      return `<article class="cell ${html(afterConfidence)}"><header><div><p class="company">${html(row.candidate)}</p><h2>${html(LABELS[row.parameterKey] ?? row.parameterKey)}</h2></div><div class="transition"><span class="pill ${html(String(row.before.final_confidence))}">${html(String(row.before.final_confidence))}</span><b>→</b><span class="pill ${html(afterConfidence)}">${html(afterConfidence)}</span></div></header><p class="value">${html(value)}</p><p class="reason">${html(String(row.after.reason ?? "No reason recorded."))}</p><div class="meta"><span>Incremental cost <strong>$${row.incrementalCostUsd.toFixed(3)}</strong></span><span>New sources <strong>${row.newEvidence.length}</strong></span></div>${sources ? `<details><summary>Inspect new evidence</summary><ul>${sources}</ul></details>` : ""}</article>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VentureX Perplexity post-pass</title><style>:root{--ink:#15352d;--muted:#66756f;--paper:#f6f3eb;--card:#fff;--line:#dcd5c7;--green:#0c6b50;--lime:#b8da57;--amber:#c78528;--gray:#687570}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.wrap{max-width:1180px;margin:auto;padding:48px 28px 72px}.eyebrow,.company{text-transform:uppercase;letter-spacing:.1em;font-size:12px;font-weight:800;color:var(--green);margin:0 0 7px}h1{font-size:42px;line-height:1.05;margin:0;max-width:820px}.lede{font-size:18px;color:var(--muted);max-width:850px;margin:18px 0 28px}.runs{font:12px ui-monospace,SFMono-Regular,monospace;color:var(--muted);overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:30px 0}.stat{background:var(--ink);color:white;padding:22px;border-radius:14px}.stat b{display:block;font-size:30px}.stat span{color:#cfe0da}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cell{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 5px 18px #17352d0a}.cell.verified{border-top:5px solid var(--green)}.cell.unknown{border-top:5px solid var(--gray)}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}h2{font-size:21px;line-height:1.2;margin:0}.transition{display:flex;gap:7px;align-items:center;white-space:nowrap}.pill{font-size:11px;font-weight:800;text-transform:uppercase;padding:5px 8px;border-radius:999px;background:#e8ece9;color:var(--gray)}.pill.verified{background:#d8efe5;color:var(--green)}.pill.inferred{background:#f7e8ce;color:#885710}.value{font-weight:750;background:#f0f4f1;border-radius:10px;padding:11px;margin:18px 0 10px}.reason{color:#3f514b}.meta{display:flex;gap:22px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted)}details{margin-top:14px}summary{cursor:pointer;font-weight:750}ul{padding-left:20px}li{margin:9px 0}li a{color:var(--green);font-weight:700}li span{display:block;color:var(--muted);font-size:12px}@media(max-width:800px){.stats,.grid{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}h1{font-size:34px}}@media print{body{background:white}.wrap{max-width:none;padding:20px}.cell{break-inside:avoid;box-shadow:none}.runs{font-size:9px}}</style></head><body><main class="wrap"><p class="eyebrow">VentureX · targeted evidence escalation</p><h1>What changed when we pulled out the big gun?</h1><p class="lede">Perplexity Deep Research ran only after the policy-routed first pass, and only on explicitly approved unknown cells. Its cited pages were fetched independently and judged by VentureX’s existing extractor and verifier.</p><p class="runs">First pass ${html(beforeRunId)}<br>Final post-pass ${html(afterRunId)}</p><section class="stats"><div class="stat"><b>${rows.length}</b><span>cells escalated</span></div><div class="stat"><b>${improved}</b><span>confidence improvement</span></div><div class="stat"><b>${upheldUnknown}</b><span>unknowns upheld</span></div><div class="stat"><b>$${totalCost.toFixed(2)}</b><span>incremental spend</span></div></section><section class="grid">${cards}</section></main></body></html>`;
}

function changed(
  before: ComparisonRow["v2"],
  after: ComparisonRow["v2"],
): boolean {
  return (
    Math.abs(number(after.cost_usd) - number(before.cost_usd)) > 0.000001 ||
    JSON.stringify(after.value ?? null) !==
      JSON.stringify(before.value ?? null) ||
    after.final_confidence !== before.final_confidence ||
    after.reason !== before.reason
  );
}

function evidence(value: ComparisonRow["v2"]): EvidenceItem[] {
  return Array.isArray(value.evidence) ? value.evidence : [];
}

function key(row: ComparisonRow): string {
  return `${row.candidate}:${row.parameter_key}`;
}

function urlFor(item: EvidenceItem): string {
  return typeof item.url === "string" ? item.url : "";
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function confidenceRank(value: string): number {
  return value === "verified" ? 2 : value === "inferred" ? 1 : 0;
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
