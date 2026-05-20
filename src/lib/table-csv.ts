import type {
  ComparisonCell,
  ComparisonParameter,
  ComparisonTableData,
} from "@/lib/table-viewer";

/**
 * M16-A4: CSV export. Wide-table shape — one row per candidate, one
 * column per parameter, plus a leading metadata block for the analysis
 * engine to identify the run.
 *
 * Cell values are JSON-stringified when they're objects/arrays, escaped
 * per RFC 4180. Empty cells render as the empty string. The CSV is
 * self-contained — no separate metadata/citation files. Citations are
 * appended to non-trivial values as " [cite: <url>]" so the analysis
 * engine can recover provenance without parsing a separate column.
 *
 * Daniel's Innovera ingest contract is still pending — this CSV is a
 * conservative shape that lands in Excel + Google Sheets cleanly. When
 * the ingest contract locks (M15.5 / M16), a structured JSON export
 * sibling will join this endpoint.
 */
export function buildComparisonCsv(data: ComparisonTableData): string {
  const cellsByKey = new Map<string, ComparisonCell>();
  for (const cell of data.cells) {
    cellsByKey.set(`${cell.candidate_id}::${cell.parameter_key}`, cell);
  }

  const lines: string[] = [];

  // Metadata header — non-breaking, lives in the leading "#" comment rows.
  // Excel/Sheets show these as data rows in column A; analysis engines can
  // skip lines starting with '#'.
  lines.push(`# VentureX comparison table CSV export`);
  lines.push(`# venture: ${csvEscape(data.venture.title)}`);
  lines.push(`# venture_id: ${csvEscape(data.venture.id)}`);
  lines.push(`# generated_at: ${csvEscape(data.venture.generated_at)}`);
  lines.push(`# exported_at: ${csvEscape(new Date().toISOString())}`);
  lines.push(`# candidates: ${data.candidates.length}`);
  lines.push(`# parameters: ${data.parameters.length}`);
  lines.push(`# cells: ${data.cells.length}`);
  lines.push("");

  // Column header rows. We emit two header rows: the first names the
  // tier (T1 / T2 / T3) for visual grouping in Excel, the second names
  // the parameter. The "_confidence" / "_citation" sibling columns are
  // omitted to keep the wide format readable — provenance is appended to
  // the value cell.
  const paramHeader: string[] = ["candidate", "candidate_id", "type"];
  const tierHeader: string[] = ["", "", ""];
  for (const param of data.parameters) {
    paramHeader.push(csvEscape(param.parameter_key));
    tierHeader.push(`T${param.tier}`);
  }
  lines.push(tierHeader.map(csvEscape).join(","));
  lines.push(paramHeader.join(","));

  for (const candidate of data.candidates) {
    const row: string[] = [
      csvEscape(candidate.name),
      csvEscape(candidate.candidate_id),
      // product_line lives on the comparison shape but the candidate-type
      // (direct / category / SPDM) is on the source candidate_companies row
      // and not propagated through table-data.ts today. Leave the column
      // for future enrichment; emit empty for now to keep schema stable.
      csvEscape(candidate.product_line ?? ""),
    ];

    for (const param of data.parameters) {
      const cell = cellsByKey.get(
        `${candidate.candidate_id}::${param.parameter_key}`,
      );
      row.push(csvEscape(renderCellForCsv(cell, param)));
    }

    lines.push(row.join(","));
  }

  // CSV files in Excel default to CRLF. Use \r\n so Excel doesn't render
  // everything on a single row when opened on Windows.
  return lines.join("\r\n") + "\r\n";
}

export function csvExportFilename(data: ComparisonTableData): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `venturex_${data.venture.slug}_${stamp}.csv`;
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

function renderCellForCsv(
  cell: ComparisonCell | undefined,
  _param: ComparisonParameter,
): string {
  if (!cell) return "";

  if (cell.confidence === "unknown") {
    // Surface the reason so the consultant doesn't have to open the dossier
    // to know whether the gap is "no evidence" vs "extraction error" vs
    // "private company".
    return cell.reason ? `[unknown] ${cell.reason}` : "[unknown]";
  }

  const valuePart = formatValueForCsv(cell.value);
  const confidencePart = cell.confidence === "inferred" ? " [inferred]" : "";

  // Append the first citation URL inline so the CSV self-documents
  // provenance. Multi-citation cells get the first only; the full set
  // lives in the HTML export.
  const citationPart =
    cell.citations.length > 0 && cell.citations[0]!.url
      ? ` [cite: ${cell.citations[0]!.url}]`
      : "";

  return `${valuePart}${confidencePart}${citationPart}`;
}

function formatValueForCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * RFC 4180-compliant CSV field escape:
 *   - If the value contains comma, double-quote, or newline, surround in
 *     double quotes and escape internal double quotes by doubling them.
 *   - Otherwise return as-is.
 */
function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
