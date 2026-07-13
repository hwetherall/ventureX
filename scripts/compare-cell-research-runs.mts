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

async function main() {
  const runId = process.argv[2];
  const baselinePath = path.resolve(
    process.argv[3] ??
      "test-cases/abb-rack-pdu/cell-quality-v1-snapshot.json",
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
  const resultRows = (results ?? []) as Array<Record<string, unknown> & { id: string; candidate_id: string; parameter_key: string }>;
  const { data: evidence, error: evidenceError } = await client.database
    .from("cell_evidence")
    .select(
      "result_id, provider, url, title, source_class, excerpt, published_at, disposition, verifier_reason",
    )
    .in(
      "result_id",
      resultRows.map((row) => row.id),
    );
  if (evidenceError) throw new Error(`Evidence load failed: ${evidenceError.message}`);
  const candidateNames = new Map(
    baseline.candidates.map((candidate) => [candidate.id, candidate.name]),
  );
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
      v1:
        baselineByKey.get(`${v2.candidate_id}:${v2.parameter_key}`) ?? null,
      v2: { ...v2, evidence: evidenceByResult.get(v2.id) ?? [] },
    }))
    .sort((a, b) =>
      `${a.candidate}:${a.parameter_key}`.localeCompare(
        `${b.candidate}:${b.parameter_key}`,
      ),
    );
  const outputDir = path.resolve("outputs", `cell-improve-${runId.slice(0, 8)}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "comparison.json"),
    `${JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), rows }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(outputDir, "comparison.csv"), makeCsv(rows));
  await fs.writeFile(path.join(outputDir, "comparison.html"), makeHtml(runId, rows));
  console.log(`Wrote ${rows.length} paired cells to ${outputDir}`);
}

function makeCsv(rows: Array<{ candidate: string; parameter_key: string; v1: BaselineCell | null; v2: Record<string, unknown> }>): string {
  const lines = [
    ["candidate", "parameter", "v1_confidence", "v1_value", "v1_url", "v2_confidence", "v2_value", "v2_evidence_count", "v2_cost_usd", "v2_latency_ms"],
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

function makeHtml(runId: string, rows: Array<{ candidate: string; parameter_key: string; v1: BaselineCell | null; v2: Record<string, unknown> }>): string {
  const body = rows
    .map((row) => {
      const evidence = (Array.isArray(row.v2.evidence) ? row.v2.evidence : []) as Array<Record<string, unknown>>;
      return `<tr><th>${html(row.candidate)}<small>${html(row.parameter_key)}</small></th><td><b>${html(row.v1?.confidence ?? "missing")}</b><pre>${html(JSON.stringify(row.v1?.value ?? null, null, 2))}</pre>${row.v1?.citation?.url ? `<a href="${html(row.v1.citation.url)}">source</a>` : ""}</td><td><b>${html(String(row.v2.final_confidence ?? "missing"))}</b><pre>${html(JSON.stringify(row.v2.value ?? null, null, 2))}</pre>${evidence.map((item) => `<details><summary>${html(String(item.provider))} · ${html(String(item.source_class))} · ${html(String(item.disposition))}</summary><a href="${html(String(item.url))}">${html(String(item.title))}</a><blockquote>${html(String(item.excerpt))}</blockquote></details>`).join("")}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>VentureX cell comparison</title><style>body{font:14px system-ui;margin:32px;color:#17332a;background:#faf8f1}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cabfae;padding:12px;vertical-align:top}th{width:18%;text-align:left;background:#104b3d;color:white}th small{display:block;font-weight:400;margin-top:6px}td{width:41%;background:white}pre{white-space:pre-wrap}blockquote{border-left:3px solid #8bb84a;padding-left:10px;color:#455}details{margin-top:10px}a{color:#08664f}</style></head><body><h1>Cell Research V1 ↔ V2</h1><p>V2 run ${html(runId)} · ${rows.length} paired cells · scoring intentionally excluded.</p><table><thead><tr><th>Cell</th><th>V1 baseline</th><th>V2 policy-routed</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function html(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
