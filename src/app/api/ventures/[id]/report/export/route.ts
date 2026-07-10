import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { loadInvestorReportData } from "@/lib/investor-report-data";
import {
  buildInvestorReportHtml,
  investorReportFilename,
} from "@/lib/investor-report";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const insforge = await createAuthedServerClient();
  const { data, error } = await loadInvestorReportData(insforge, id);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Venture not found" }, { status: 404 });
  }
  if (data.candidates.length === 0 || data.parameters.length === 0) {
    return NextResponse.json(
      {
        error:
          "The investor report needs researched candidates and parameters.",
      },
      { status: 422 },
    );
  }

  const html = buildInvestorReportHtml(data);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Open the artifact as a document so the user can inspect it and use
      // the report's print control to create the investor-facing PDF.
      "Content-Disposition": `inline; filename="${investorReportFilename(data)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
