import { promises as fs } from "node:fs";
import path from "node:path";

import { makeResearchOpsClient } from "./lib/research-ops-client.mjs";

async function main() {
  const ventureId = process.argv[2];
  const outputArg = process.argv[3];
  if (!ventureId) {
    throw new Error(
      "Usage: tsx --env-file=.env scripts/snapshot-cell-baseline.mts <venture_id> [output.json]",
    );
  }
  const outputPath = path.resolve(
    outputArg ??
      "test-cases/abb-rack-pdu/cell-quality-v1-snapshot.json",
  );
  const client = await makeResearchOpsClient();
  const [{ data: venture, error: ventureError }, { data: candidates, error: candidateError }, { data: parameterRuns, error: parameterError }] =
    await Promise.all([
      client.database
        .from("ventures")
        .select("id, status, user_provided_description, created_at")
        .eq("id", ventureId)
        .single(),
      client.database
        .from("candidate_companies")
        .select("id, name, type")
        .eq("venture_id", ventureId),
      client.database
        .from("parameter_generation_runs")
        .select("id, full_parameter_schema, created_at")
        .eq("venture_id", ventureId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
  if (ventureError || !venture) {
    throw new Error(`Venture load failed: ${ventureError?.message ?? "not found"}`);
  }
  if (candidateError) throw new Error(`Candidate load failed: ${candidateError.message}`);
  if (parameterError) throw new Error(`Parameter load failed: ${parameterError.message}`);
  const candidateRows = (candidates ?? []) as Array<{ id: string; name: string }>;
  const { data: cells, error: cellsError } = await client.database
    .from("cells")
    .select(
      "id, candidate_id, parameter_key, tier, value, citation, confidence, reason, created_at",
    )
    .in(
      "candidate_id",
      candidateRows.map((candidate) => candidate.id),
    );
  if (cellsError) throw new Error(`Cell load failed: ${cellsError.message}`);
  const snapshot = {
    schema_version: 1,
    pipeline_version: "v1_snapshot",
    captured_at: new Date().toISOString(),
    venture,
    candidates: candidates ?? [],
    parameter_run: parameterRuns?.[0] ?? null,
    cells: (cells ?? []).sort(
      (a: { candidate_id: string; parameter_key: string }, b: { candidate_id: string; parameter_key: string }) =>
        `${a.candidate_id}:${a.parameter_key}`.localeCompare(
          `${b.candidate_id}:${b.parameter_key}`,
        ),
    ),
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `Captured ${(cells ?? []).length} canonical cells for ${candidateRows.length} candidates at ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
