import { describe, expect, it } from "vitest";

import { sampleReportData } from "@/lib/investor-report-fixture.test-helper";
import {
  buildInvestorReportHtml,
  investorReportFilename,
} from "@/lib/investor-report";

describe("investor report HTML", () => {
  it("renders the narrative sequence, ranked competitors, matrix, logos, and sources", () => {
    const data = sampleReportData();
    const html = buildInvestorReportHtml(data, "2026-07-09T12:00:00.000Z");

    expect(html).toContain("Venture profile");
    expect(html).toContain("Weighted decision lens");
    expect(html).toContain("Ranked competitors");
    expect(html).toContain("Why it matters");
    expect(html).toContain("Complete 3 × 10 focused appendix");
    expect(html).toContain("Print / save as PDF");
    expect(html).toContain("https://alpha.example/favicon.ico");
    expect(html).toContain('id="source-1"');
    expect(html).toContain('href="#source-1"');
    expect(html).toContain("Source &amp; proof");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("creates a dated, venture-specific filename", () => {
    expect(investorReportFilename(sampleReportData())).toMatch(
      /^venturex_rack-power_landscape_\d{8}\.html$/,
    );
  });
});
