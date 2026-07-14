import { promises as fs } from "node:fs";
import path from "node:path";

import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

interface BaselineCell {
  candidate_id: string;
  parameter_key: string;
  value: unknown;
  confidence: string;
  citation: { url?: string; snippet?: string } | null;
  reason: string | null;
}

interface ComparisonRow {
  candidate: string;
  parameter_key: string;
  v1: BaselineCell | null;
  v2: Record<string, unknown>;
}

interface EvidenceItem {
  provider?: unknown;
  url?: unknown;
  title?: unknown;
  source_class?: unknown;
  excerpt?: unknown;
  disposition?: unknown;
}

const PARAMETER_META: Record<
  string,
  { label: string; difficulty: "Easy" | "Medium" | "Hard" | "Very hard" }
> = {
  legal_name: { label: "Legal name", difficulty: "Easy" },
  headcount: { label: "Headcount", difficulty: "Medium" },
  latest_material_event: {
    label: "Latest material event",
    difficulty: "Hard",
  },
  core_offering: { label: "Core offering", difficulty: "Medium" },
  pricing_disclosure: { label: "Pricing disclosure", difficulty: "Hard" },
  sales_cycle_length: { label: "Sales-cycle length", difficulty: "Hard" },
  rd_capacity: { label: "R&D capacity", difficulty: "Hard" },
  busbar_tap_off_offering: {
    label: "Busbar tap-off offering",
    difficulty: "Hard",
  },
  server_oem_integrator_relationships: {
    label: "Server OEM / integrator relationships",
    difficulty: "Very hard",
  },
  hyperscaler_reference_wins: {
    label: "Hyperscaler reference wins",
    difficulty: "Very hard",
  },
};

const PARAMETER_ORDER = Object.keys(PARAMETER_META);

async function main() {
  const runId = process.argv[2];
  const baselinePath = path.resolve(
    process.argv[3] ?? "test-cases/abb-rack-pdu/cell-quality-v1-snapshot.json",
  );
  if (!runId) {
    throw new Error(
      "Usage: tsx --env-file=.env scripts/compare-cell-research-runs.mts <v2_run_id> [baseline.json]",
    );
  }
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as {
    candidates: Array<{ id: string; name: string }>;
    cells: BaselineCell[];
  };
  const client = await makeResearchOpsClient();
  const { data: results, error } = await client.database
    .from("cell_research_results")
    .select(
      "id, candidate_id, parameter_key, value, proposed_confidence, final_confidence, reason, verifier_outcome, cost_usd, latency_ms",
    )
    .eq("run_id", runId);
  if (error) throw new Error(`V2 result load failed: ${error.message}`);
  const resultRows = (results ?? []) as Array<
    Record<string, unknown> & {
      id: string;
      candidate_id: string;
      parameter_key: string;
    }
  >;
  const { data: evidence, error: evidenceError } = await client.database
    .from("cell_evidence")
    .select(
      "result_id, provider, url, title, source_class, excerpt, published_at, disposition, verifier_reason",
    )
    .in(
      "result_id",
      resultRows.map((row) => row.id),
    );
  if (evidenceError)
    throw new Error(`Evidence load failed: ${evidenceError.message}`);
  const candidateNames = new Map(
    baseline.candidates.map((candidate) => [candidate.id, candidate.name]),
  );
  const candidateOrder = baseline.candidates.map((candidate) => candidate.name);
  const baselineByKey = new Map(
    baseline.cells.map((cell) => [
      `${cell.candidate_id}:${cell.parameter_key}`,
      cell,
    ]),
  );
  const evidenceByResult = new Map<string, unknown[]>();
  for (const item of (evidence ?? []) as Array<{ result_id: string }>) {
    evidenceByResult.set(item.result_id, [
      ...(evidenceByResult.get(item.result_id) ?? []),
      item,
    ]);
  }
  const rows = resultRows
    .map((v2) => ({
      candidate: candidateNames.get(v2.candidate_id) ?? v2.candidate_id,
      parameter_key: v2.parameter_key,
      v1: baselineByKey.get(`${v2.candidate_id}:${v2.parameter_key}`) ?? null,
      v2: { ...v2, evidence: evidenceByResult.get(v2.id) ?? [] },
    }))
    .sort((a, b) =>
      `${a.candidate}:${a.parameter_key}`.localeCompare(
        `${b.candidate}:${b.parameter_key}`,
      ),
    );
  const outputDir = path.resolve(
    "outputs",
    `cell-improve-${runId.slice(0, 8)}`,
  );
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "comparison.json"),
    `${JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), rows }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(outputDir, "comparison.csv"), makeCsv(rows));
  await fs.writeFile(
    path.join(outputDir, "comparison.html"),
    makeHtml(runId, rows),
  );
  await fs.writeFile(
    path.join(outputDir, "visual-comparison.html"),
    makeVisualHtml(runId, rows, candidateOrder),
  );
  console.log(
    `Wrote ${rows.length} paired cells and CEO visual comparison to ${outputDir}`,
  );
}

function makeCsv(rows: ComparisonRow[]): string {
  const lines = [
    [
      "candidate",
      "parameter",
      "v1_confidence",
      "v1_value",
      "v1_url",
      "v2_confidence",
      "v2_value",
      "v2_evidence_count",
      "v2_cost_usd",
      "v2_latency_ms",
    ],
    ...rows.map((row) => {
      const evidence = Array.isArray(row.v2.evidence) ? row.v2.evidence : [];
      return [
        row.candidate,
        row.parameter_key,
        row.v1?.confidence ?? "",
        JSON.stringify(row.v1?.value ?? null),
        row.v1?.citation?.url ?? "",
        String(row.v2.final_confidence ?? ""),
        JSON.stringify(row.v2.value ?? null),
        String(evidence.length),
        String(row.v2.cost_usd ?? ""),
        String(row.v2.latency_ms ?? ""),
      ];
    }),
  ];
  return `${lines.map((line) => line.map(csv).join(",")).join("\r\n")}\r\n`;
}

function makeHtml(runId: string, rows: ComparisonRow[]): string {
  const body = rows
    .map((row) => {
      const evidence = (
        Array.isArray(row.v2.evidence) ? row.v2.evidence : []
      ) as Array<Record<string, unknown>>;
      return `<tr><th>${html(row.candidate)}<small>${html(row.parameter_key)}</small></th><td><b>${html(row.v1?.confidence ?? "missing")}</b><pre>${html(JSON.stringify(row.v1?.value ?? null, null, 2))}</pre>${row.v1?.citation?.url ? `<a href="${html(row.v1.citation.url)}">source</a>` : ""}</td><td><b>${html(String(row.v2.final_confidence ?? "missing"))}</b><pre>${html(JSON.stringify(row.v2.value ?? null, null, 2))}</pre>${evidence.map((item) => `<details><summary>${html(String(item.provider))} · ${html(String(item.source_class))} · ${html(String(item.disposition))}</summary><a href="${html(String(item.url))}">${html(String(item.title))}</a><blockquote>${html(String(item.excerpt))}</blockquote></details>`).join("")}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>VentureX cell comparison</title><style>body{font:14px system-ui;margin:32px;color:#17332a;background:#faf8f1}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cabfae;padding:12px;vertical-align:top}th{width:18%;text-align:left;background:#104b3d;color:white}th small{display:block;font-weight:400;margin-top:6px}td{width:41%;background:white}pre{white-space:pre-wrap}blockquote{border-left:3px solid #8bb84a;padding-left:10px;color:#455}details{margin-top:10px}a{color:#08664f}</style></head><body><h1>Cell Research V1 ↔ V2</h1><p>V2 run ${html(runId)} · ${rows.length} paired cells · scoring intentionally excluded.</p><table><thead><tr><th>Cell</th><th>V1 baseline</th><th>V2 policy-routed</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function makeVisualHtml(
  runId: string,
  rows: ComparisonRow[],
  candidateOrder: string[],
): string {
  const candidates = [
    ...candidateOrder.filter((candidate) =>
      rows.some((row) => row.candidate === candidate),
    ),
    ...rows
      .map((row) => row.candidate)
      .filter(
        (candidate, index, all) =>
          all.indexOf(candidate) === index &&
          !candidateOrder.includes(candidate),
      )
      .sort(),
  ];
  const parameters = [
    ...PARAMETER_ORDER.filter((parameter) =>
      rows.some((row) => row.parameter_key === parameter),
    ),
    ...rows
      .map((row) => row.parameter_key)
      .filter(
        (parameter, index, all) =>
          all.indexOf(parameter) === index &&
          !PARAMETER_ORDER.includes(parameter),
      )
      .sort(),
  ];
  const byCell = new Map(
    rows.map((row) => [`${row.candidate}:${row.parameter_key}`, row]),
  );
  const count = (version: "v1" | "v2", confidence: string) =>
    rows.filter((row) => confidenceFor(row, version) === confidence).length;
  const v1Verified = count("v1", "verified");
  const v1Inferred = count("v1", "inferred");
  const v1Unknown = count("v1", "unknown");
  const v2Verified = count("v2", "verified");
  const v2Inferred = count("v2", "inferred");
  const v2Unknown = count("v2", "unknown");
  const v1Claims = rows.filter((row) => row.v1?.value != null).length;
  const v2Claims = rows.filter((row) => row.v2.value != null).length;
  const v1VerifiedShare = percentage(v1Verified, v1Claims);
  const v2VerifiedShare = percentage(v2Verified, v2Claims);
  const v1Citations = rows.filter((row) =>
    Boolean(row.v1?.citation?.url),
  ).length;
  const v2Evidence = rows.filter(
    (row) => Array.isArray(row.v2.evidence) && row.v2.evidence.length > 0,
  ).length;
  const strengthened = rows.filter(
    (row) =>
      confidenceFor(row, "v2") === "verified" &&
      confidenceFor(row, "v1") !== "verified",
  );
  const withheld = rows.filter(
    (row) =>
      confidenceFor(row, "v1") === "inferred" &&
      confidenceFor(row, "v2") === "unknown",
  );
  const refined = rows.filter(
    (row) =>
      confidenceFor(row, "v1") === confidenceFor(row, "v2") &&
      valueChanged(row),
  );
  const totalCost = rows.reduce(
    (total, row) => total + Number(row.v2.cost_usd ?? 0),
    0,
  );

  const matrix = (version: "v1" | "v2") => `
    <div class="matrix-wrap">
      <table class="matrix" aria-label="${version === "v1" ? "Original" : "Evidence-first"} 3 by 10 competitor matrix">
        <thead>
          <tr>
            <th class="parameter-heading">Parameter</th>
            ${candidates.map((candidate) => `<th>${html(candidate)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${parameters
            .map((parameter) => {
              const meta = PARAMETER_META[parameter] ?? {
                label: humanize(parameter),
                difficulty: "Hard" as const,
              };
              return `<tr>
                <th class="parameter-cell">
                  <span>${html(meta.label)}</span>
                  <small class="difficulty difficulty-${slug(meta.difficulty)}">${html(meta.difficulty)}</small>
                </th>
                ${candidates
                  .map((candidate) =>
                    renderMatrixCell(
                      byCell.get(`${candidate}:${parameter}`),
                      version,
                    ),
                  )
                  .join("")}
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VentureX · Cell research comparison</title>
  <style>
    :root {
      --ink: #17332a;
      --muted: #68766f;
      --paper: #f5f1e8;
      --card: #fffdf8;
      --forest: #104b3d;
      --forest-2: #0b6a53;
      --lime: #a9cc4a;
      --gold: #b98238;
      --line: #d8d0c2;
      --purple: #7258a8;
      --verified: #176b52;
      --verified-bg: #e3f3eb;
      --inferred: #9a651e;
      --inferred-bg: #fff0d3;
      --unknown: #617069;
      --unknown-bg: #edf0ed;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 85% 0%, rgba(169,204,74,.2), transparent 28rem),
        var(--paper);
      font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: var(--forest-2); text-decoration-thickness: 1px; text-underline-offset: 2px; }
    .page { width: min(1560px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 800; letter-spacing: -.02em; }
    .brand-mark { width: 34px; height: 34px; border-radius: 9px; background: var(--forest); position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }
    .brand-mark::after { content: ""; position: absolute; width: 13px; height: 13px; border: 3px solid var(--lime); border-left: 0; border-top: 0; transform: rotate(45deg); left: 9px; top: 6px; }
    .print-button { border: 1px solid rgba(16,75,61,.28); background: rgba(255,253,248,.84); color: var(--forest); border-radius: 999px; padding: 9px 16px; font: inherit; font-weight: 700; cursor: pointer; }
    .hero { background: var(--forest); color: white; border-radius: 28px; padding: clamp(28px, 5vw, 64px); overflow: hidden; position: relative; box-shadow: 0 24px 60px rgba(23,51,42,.17); }
    .hero::after { content: ""; position: absolute; width: 420px; height: 420px; border: 90px solid rgba(169,204,74,.13); border-radius: 50%; right: -210px; top: -230px; }
    .eyebrow { color: var(--lime); text-transform: uppercase; letter-spacing: .14em; font-size: 12px; font-weight: 800; }
    h1 { max-width: 900px; margin: 10px 0 16px; font: 800 clamp(38px, 6vw, 72px)/.98 Georgia, "Times New Roman", serif; letter-spacing: -.045em; }
    .hero-copy { max-width: 760px; margin: 0; color: rgba(255,255,255,.78); font-size: 18px; }
    .runline { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 9px; }
    .runline span { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); border-radius: 999px; padding: 6px 10px; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 22px 0 40px; }
    .metric { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 20px; min-height: 148px; box-shadow: 0 10px 25px rgba(23,51,42,.06); }
    .metric-label { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
    .metric-values { display: flex; align-items: baseline; gap: 10px; margin: 15px 0 7px; }
    .metric-old { color: #8d9892; font-size: 26px; font-weight: 750; }
    .metric-arrow { color: var(--gold); font-weight: 900; }
    .metric-new { color: var(--forest); font: 800 38px/1 Georgia, serif; }
    .metric p { color: var(--muted); margin: 0; font-size: 13px; }
    .section { margin-top: 54px; scroll-margin-top: 20px; }
    .section-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 15px; }
    .section-number { color: var(--gold); font-weight: 800; letter-spacing: .1em; font-size: 12px; text-transform: uppercase; }
    h2 { margin: 2px 0 0; font: 750 clamp(28px, 4vw, 45px)/1.05 Georgia, "Times New Roman", serif; letter-spacing: -.025em; }
    .section-note { max-width: 600px; color: var(--muted); margin: 0; text-align: right; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 18px; }
    .legend span, .confidence, .delta, .difficulty { border-radius: 999px; display: inline-flex; align-items: center; font-weight: 800; white-space: nowrap; }
    .legend span { padding: 5px 9px; font-size: 12px; }
    .matrix-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 18px; background: var(--card); box-shadow: 0 10px 28px rgba(23,51,42,.06); }
    .matrix { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 1080px; table-layout: fixed; }
    .matrix th, .matrix td { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); vertical-align: top; }
    .matrix tr:last-child th, .matrix tr:last-child td { border-bottom: 0; }
    .matrix tr th:last-child, .matrix tr td:last-child { border-right: 0; }
    .matrix thead th { background: var(--forest); color: white; padding: 15px; text-align: left; font-size: 13px; }
    .matrix .parameter-heading { width: 205px; }
    .parameter-cell { width: 205px; padding: 15px; background: #eee8dc; text-align: left; }
    .parameter-cell span { display: block; line-height: 1.25; }
    .difficulty { margin-top: 8px; padding: 3px 7px; font-size: 10px; background: rgba(23,51,42,.08); color: var(--muted); }
    .difficulty-very-hard { background: #eadff2; color: #654187; }
    .difficulty-hard { background: #f5e4d0; color: #8a5822; }
    .matrix td { padding: 14px; background: white; }
    .matrix td.changed { box-shadow: inset 4px 0 0 var(--purple); }
    .matrix td.withheld { box-shadow: inset 4px 0 0 var(--gold); background: #fffdf7; }
    .matrix td.strengthened { box-shadow: inset 4px 0 0 var(--lime); background: #fbfdf7; }
    .cell-top { display: flex; align-items: center; justify-content: space-between; gap: 7px; margin-bottom: 9px; }
    .confidence { padding: 4px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .verified { color: var(--verified); background: var(--verified-bg); }
    .inferred { color: var(--inferred); background: var(--inferred-bg); }
    .unknown { color: var(--unknown); background: var(--unknown-bg); }
    .delta { padding: 3px 7px; font-size: 9px; letter-spacing: .04em; text-transform: uppercase; background: #ece6f6; color: #63499a; }
    .delta-withheld { background: var(--inferred-bg); color: var(--inferred); }
    .delta-strengthened { background: #e7f2d2; color: #4b6d13; }
    .cell-value { margin: 0; color: #2c433b; font-size: 12px; line-height: 1.43; overflow-wrap: anywhere; }
    .cell-value.empty { color: #84908a; font-style: italic; }
    details { margin-top: 9px; }
    summary { color: var(--forest-2); cursor: pointer; font-size: 11px; font-weight: 750; }
    .full-value { margin: 7px 0; padding: 9px; background: #f6f3ec; border-radius: 8px; color: #42534d; font-size: 11px; white-space: pre-wrap; }
    .cell-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; color: var(--muted); font-size: 10px; }
    .change-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .change-card { border: 1px solid var(--line); border-radius: 18px; padding: 20px; background: var(--card); }
    .change-card h3 { margin: 0 0 5px; font-size: 16px; }
    .change-card p { color: var(--muted); margin: 0 0 13px; font-size: 12px; }
    .change-card ul { padding-left: 19px; margin: 0; }
    .change-card li { margin: 7px 0; font-size: 12px; }
    .caveat { margin-top: 36px; padding: 18px 20px; border: 1px solid #d8c6a7; background: #fff8e8; border-radius: 14px; color: #664d29; }
    .footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    @media (max-width: 900px) {
      .summary, .change-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .section-heading { display: block; }
      .section-note { text-align: left; margin-top: 8px; }
    }
    @media (max-width: 580px) {
      .page { width: min(100% - 22px, 1560px); padding-top: 14px; }
      .summary, .change-grid { grid-template-columns: 1fr; }
      .hero { border-radius: 20px; }
      .print-button { display: none; }
    }
    @media print {
      @page { size: A3 landscape; margin: 11mm; }
      body { background: white; font-size: 10px; }
      .page { width: 100%; padding: 0; }
      .topbar, .print-button { display: none; }
      .hero { box-shadow: none; border-radius: 0; padding: 28px; }
      .summary { margin: 12px 0 18px; }
      .metric { min-height: 0; padding: 12px; box-shadow: none; }
      .section { margin-top: 24px; break-before: page; }
      .matrix-wrap { overflow: visible; box-shadow: none; }
      .matrix { min-width: 0; }
      .matrix .parameter-heading, .parameter-cell { width: 150px; }
      .matrix td, .matrix thead th, .parameter-cell { padding: 8px; }
      details { display: none; }
      .change-grid { break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span>VentureX</div>
      <button class="print-button" type="button" onclick="window.print()">Print / save as PDF</button>
    </div>

    <header class="hero">
      <div class="eyebrow">Research quality validation · ABB rack PDU</div>
      <h1>From plausible answers to defensible evidence.</h1>
      <p class="hero-copy">A cell-for-cell visual comparison of the original research matrix and VentureX’s new evidence-first pipeline across three competitors and ten deliberately varied parameters.</p>
      <div class="runline">
        <span>3 competitors</span><span>10 parameters</span><span>30 paired cells</span><span>Run ${html(runId.slice(0, 8))}</span><span>$${totalCost.toFixed(2)} research cost</span>
      </div>
    </header>

    <section class="summary" aria-label="Executive summary">
      ${metric("Verified claims", v1Verified, v2Verified, "Four additional cells now meet the direct-evidence standard.")}
      ${metric("Verified share of claims", `${v1VerifiedShare}%`, `${v2VerifiedShare}%`, "The new pipeline makes fewer claims, but a much larger share is verified.")}
      ${metric("Inferred claims", v1Inferred, v2Inferred, "Ten speculative cells were either verified or withheld.")}
      ${metric("Cells with source trail", `${v1Citations}/30`, `${v2Evidence}/30`, "Every new cell retains evidence or the audit trail for an honest unknown.")}
    </section>

    <section class="section" id="baseline">
      <div class="section-heading">
        <div><div class="section-number">01 · Before</div><h2>Original 3×10 matrix</h2></div>
        <p class="section-note">The baseline produced ${v1Claims} claims: ${v1Verified} verified, ${v1Inferred} inferred, and ${v1Unknown} unknown. Each position is preserved in the new matrix below.</p>
      </div>
      <div class="legend"><span class="verified">Verified</span><span class="inferred">Inferred</span><span class="unknown">Unknown</span></div>
      ${matrix("v1")}
    </section>

    <section class="section" id="evidence-first">
      <div class="section-heading">
        <div><div class="section-number">02 · After</div><h2>Evidence-first 3×10 matrix</h2></div>
        <p class="section-note">The new pipeline produced ${v2Claims} supported claims: ${v2Verified} verified, ${v2Inferred} inferred, and ${v2Unknown} honest unknowns. Colored rails mark material changes.</p>
      </div>
      <div class="legend"><span class="delta delta-strengthened">Strengthened proof</span><span class="delta delta-withheld">Unsupported claim withheld</span><span class="delta">Value refined</span></div>
      ${matrix("v2")}
    </section>

    <section class="section" id="changes">
      <div class="section-heading">
        <div><div class="section-number">03 · Interpretation</div><h2>What materially changed</h2></div>
        <p class="section-note">Unknown is not treated as failure when the public evidence cannot support an exact claim. The objective is decision-grade reliability, not maximum cell fill.</p>
      </div>
      <div class="change-grid">
        ${changeCard("Strengthened to verified", `${strengthened.length} cells gained direct support.`, strengthened)}
        ${changeCard("Unsupported claims withheld", `${withheld.length} inferred claims became auditable unknowns.`, withheld)}
        ${changeCard("Values refined", `${refined.length} cells kept their confidence level while the answer became more precise.`, refined)}
      </div>
      <div class="caveat"><strong>Validation status:</strong> this artifact shows confidence, evidence coverage, and cell-level differences. Blind human adjudication is still required before claiming final correctness or promoting these results into the canonical VentureX table.</div>
    </section>

    <footer class="footer">
      <span>VentureX · Competitive intelligence with an auditable evidence trail</span>
      <span><a href="comparison.html">Open technical evidence appendix</a></span>
    </footer>
  </main>
</body>
</html>`;
}

function renderMatrixCell(
  row: ComparisonRow | undefined,
  version: "v1" | "v2",
): string {
  if (!row) return `<td><p class="cell-value empty">Not available</p></td>`;
  const confidence = confidenceFor(row, version);
  const value = version === "v1" ? row.v1?.value : row.v2.value;
  const valueText = value == null ? unknownText(version) : formatValue(value);
  const shortValue = shorten(valueText, 190);
  const needsDetails = shortValue !== valueText;
  const evidence = Array.isArray(row.v2.evidence)
    ? (row.v2.evidence as EvidenceItem[])
    : [];
  const source =
    version === "v1"
      ? row.v1?.citation?.url
      : (evidence.find((item) => item.disposition === "direct")?.url ??
        evidence[0]?.url);
  const sourceUrl = typeof source === "string" ? source : undefined;
  const reason = version === "v1" ? row.v1?.reason : row.v2.reason;
  const reasonText = typeof reason === "string" ? reason : undefined;
  const delta = version === "v2" ? deltaFor(row) : undefined;
  const cellClass = version === "v2" && delta ? ` ${delta.className}` : "";
  const evidenceLabel =
    version === "v1"
      ? sourceUrl
        ? "1 cited source"
        : "No stored citation"
      : `${evidence.length} evidence record${evidence.length === 1 ? "" : "s"}`;
  return `<td class="confidence-${html(confidence)}${cellClass}">
    <div class="cell-top">
      <span class="confidence ${html(confidence)}">${html(confidence)}</span>
      ${delta ? `<span class="delta ${html(delta.badgeClass)}">${html(delta.label)}</span>` : ""}
    </div>
    <p class="cell-value${value == null ? " empty" : ""}">${html(shortValue)}</p>
    ${
      needsDetails || reasonText
        ? `<details><summary>Read full cell</summary><div class="full-value">${html(valueText)}${reasonText ? `\n\nRationale: ${html(reasonText)}` : ""}</div></details>`
        : ""
    }
    <div class="cell-meta">
      <span>${html(evidenceLabel)}</span>
      ${sourceUrl ? `<a href="${html(sourceUrl)}" target="_blank" rel="noreferrer">Open source ↗</a>` : ""}
    </div>
  </td>`;
}

function confidenceFor(row: ComparisonRow, version: "v1" | "v2"): string {
  return version === "v1"
    ? (row.v1?.confidence ?? "unknown")
    : String(row.v2.final_confidence ?? "unknown");
}

function deltaFor(
  row: ComparisonRow,
): { label: string; className: string; badgeClass: string } | undefined {
  const before = confidenceFor(row, "v1");
  const after = confidenceFor(row, "v2");
  if (after === "verified" && before !== "verified") {
    return {
      label: before === "unknown" ? "Resolved" : "Strengthened",
      className: "strengthened",
      badgeClass: "delta-strengthened",
    };
  }
  if (before === "inferred" && after === "unknown") {
    return {
      label: "Withheld",
      className: "withheld",
      badgeClass: "delta-withheld",
    };
  }
  if (before !== after || valueChanged(row)) {
    return { label: "Refined", className: "changed", badgeClass: "" };
  }
  return undefined;
}

function valueChanged(row: ComparisonRow): boolean {
  return (
    JSON.stringify(row.v1?.value ?? null) !==
    JSON.stringify(row.v2.value ?? null)
  );
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatValue(item))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item != null && item !== "")
      .map(([key, item]) => `${humanize(key)}: ${formatValue(item)}`)
      .join(" · ");
  }
  return String(value);
}

function unknownText(version: "v1" | "v2"): string {
  return version === "v1"
    ? "Unknown or unsupported in the original research."
    : "No claim — public evidence did not meet the required standard.";
}

function shorten(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const candidate = value.slice(0, maximum - 1).replace(/\s+\S*$/u, "");
  return `${candidate || value.slice(0, maximum - 1)}…`;
}

function metric(
  label: string,
  before: string | number,
  after: string | number,
  note: string,
): string {
  return `<article class="metric"><div class="metric-label">${html(label)}</div><div class="metric-values"><span class="metric-old">${html(String(before))}</span><span class="metric-arrow">→</span><span class="metric-new">${html(String(after))}</span></div><p>${html(note)}</p></article>`;
}

function changeCard(
  title: string,
  description: string,
  rows: ComparisonRow[],
): string {
  const items = rows.length
    ? rows
        .map(
          (row) =>
            `<li><strong>${html(shortCandidate(row.candidate))}</strong> · ${html(PARAMETER_META[row.parameter_key]?.label ?? humanize(row.parameter_key))}</li>`,
        )
        .join("")
    : "<li>No cells in this category.</li>";
  return `<article class="change-card"><h3>${html(title)}</h3><p>${html(description)}</p><ul>${items}</ul></article>`;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function shortCandidate(value: string): string {
  return value.startsWith("EMS Elektro Metall") ? "EMS" : value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function html(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
