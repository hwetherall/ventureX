import { describe, expect, it } from "vitest";

import type {
  ComparisonCandidate,
  ComparisonCell,
  ComparisonParameter,
  ComparisonTableData,
} from "@/lib/table-viewer";

import { buildComparisonCsv, csvExportFilename } from "./table-csv";

const FIXED_VENTURE: ComparisonTableData["venture"] = {
  id: "v-1",
  slug: "abb-rack-pdu",
  title: "ABB Rack PDU",
  generated_at: "2026-05-20T12:00:00Z",
};

function param(
  parameter_key: string,
  tier: 1 | 2 | 3,
  parameter_label = parameter_key,
): ComparisonParameter {
  return {
    parameter_key,
    parameter_label,
    tier,
    description: "",
    value_shape: "string",
  };
}

function candidate(id: string, name: string): ComparisonCandidate {
  return {
    candidate_id: id,
    name,
    product_line: null,
    logo_url: null,
    stats: { total: 0, verified: 0, inferred: 0, unknown: 0 },
  };
}

function verifiedCell(
  candidate_id: string,
  parameter_key: string,
  value: unknown,
  url?: string,
): ComparisonCell {
  return {
    candidate_id,
    parameter_key,
    tier: 1,
    confidence: "verified",
    value,
    citations: url
      ? [
          {
            source_title: "src",
            url,
            snippet: "",
            retrieved_at: "2026-05-20T12:00:00Z",
          },
        ]
      : [],
    reason: null,
    retrieved_at: null,
  };
}

describe("buildComparisonCsv", () => {
  it("emits a metadata block followed by tier header + parameter header rows", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Schneider Electric")],
      parameters: [param("founded_year", 1), param("core_offering", 2)],
      cells: [verifiedCell("c1", "founded_year", 1836)],
    };

    const csv = buildComparisonCsv(data);
    const lines = csv.split("\r\n");

    expect(lines[0]).toContain("VentureX comparison table");
    expect(lines.some((l) => l.includes("venture: ABB Rack PDU"))).toBe(true);
    // Find the column-header pair (tier row + key row) — they follow the
    // empty blank line after the comment block.
    const blankIdx = lines.findIndex((l) => l === "");
    expect(blankIdx).toBeGreaterThan(0);
    // First three columns are candidate name/id/type — empty in tier row.
    expect(lines[blankIdx + 1]).toBe(",,,T1,T2");
    expect(lines[blankIdx + 2]).toBe(
      "candidate,candidate_id,type,founded_year,core_offering",
    );
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Acme, Inc.")],
      parameters: [param("core_offering", 2)],
      cells: [
        verifiedCell(
          "c1",
          "core_offering",
          'Power distribution, "as a service"\nincluding monitoring',
        ),
      ],
    };

    const csv = buildComparisonCsv(data);
    // Acme, Inc. has a comma — must be double-quoted.
    expect(csv).toContain('"Acme, Inc."');
    // The value with embedded quotes + newline — internal quotes doubled,
    // whole field quoted.
    expect(csv).toContain('""as a service""');
  });

  it("renders unknown cells with their reason for analysis-engine visibility", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Acme")],
      parameters: [param("margin_profile", 2)],
      cells: [
        {
          candidate_id: "c1",
          parameter_key: "margin_profile",
          tier: 2,
          confidence: "unknown",
          value: null,
          citations: [],
          reason: "no_evidence_found",
          retrieved_at: null,
        },
      ],
    };

    const csv = buildComparisonCsv(data);
    expect(csv).toContain("[unknown] no_evidence_found");
  });

  it("appends citation URL inline for verified/inferred cells", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Schneider Electric")],
      parameters: [param("core_offering", 2)],
      cells: [
        verifiedCell(
          "c1",
          "core_offering",
          "Power distribution",
          "https://www.se.com/about",
        ),
      ],
    };

    const csv = buildComparisonCsv(data);
    expect(csv).toContain("[cite: https://www.se.com/about]");
  });

  it("marks inferred cells with [inferred] tag", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Vertiv")],
      parameters: [param("capital_intensity", 2)],
      cells: [
        {
          candidate_id: "c1",
          parameter_key: "capital_intensity",
          tier: 2,
          confidence: "inferred",
          value: "high",
          citations: [],
          reason: null,
          retrieved_at: null,
        },
      ],
    };

    const csv = buildComparisonCsv(data);
    expect(csv).toContain("high [inferred]");
  });

  it("emits empty string for missing cells (candidate has no row for parameter)", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Acme")],
      parameters: [param("founded_year", 1), param("annual_revenue", 1)],
      cells: [verifiedCell("c1", "founded_year", 1900)],
    };

    const csv = buildComparisonCsv(data);
    const lines = csv.split("\r\n");
    const dataRow = lines.find((l) => l.startsWith("Acme,"));
    expect(dataRow).toBe("Acme,c1,,1900,");
  });

  it("uses CRLF line endings for Excel compatibility", () => {
    const data: ComparisonTableData = {
      venture: FIXED_VENTURE,
      candidates: [candidate("c1", "Acme")],
      parameters: [param("founded_year", 1)],
      cells: [verifiedCell("c1", "founded_year", 1900)],
    };

    const csv = buildComparisonCsv(data);
    expect(csv).toContain("\r\n");
  });
});

describe("csvExportFilename", () => {
  it("returns a date-stamped slug-based name", () => {
    const name = csvExportFilename({
      ...({} as ComparisonTableData),
      venture: { ...FIXED_VENTURE, slug: "abb-rack-pdu" },
    });
    expect(name).toMatch(/^venturex_abb-rack-pdu_\d{8}\.csv$/);
  });
});
