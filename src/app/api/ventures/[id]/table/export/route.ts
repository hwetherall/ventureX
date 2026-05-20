import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { loadComparisonTableData } from "@/lib/table-data";
import {
  buildStandaloneTableHtml,
  tableExportFilename,
} from "@/lib/table-export";

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

  const html = buildStandaloneTableHtml(data);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tableExportFilename(data)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
