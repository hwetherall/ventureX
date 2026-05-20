import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { loadComparisonTableData } from "@/lib/table-data";
import {
  buildComparisonCsv,
  csvExportFilename,
} from "@/lib/table-csv";

/**
 * M16-A4: CSV export endpoint. Sibling to the HTML export — same data
 * shape, different deliverable. Daniel can drop this straight into Excel
 * or the Innovera analysis engine without any HTML parsing step.
 *
 * GET /api/ventures/[id]/table/export.csv
 */
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
  const { data, error } = await loadComparisonTableData(insforge, id);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Venture not found" }, { status: 404 });
  }

  const csv = buildComparisonCsv(data);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvExportFilename(data)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
