import { mkdirSync, writeFileSync } from "node:fs";

const tableName = process.argv[2] ?? "candidate_companies";
const input = await new Promise((resolve, reject) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
  });
  process.stdin.on("end", () => resolve(buf));
  process.stdin.on("error", reject);
});

const data = JSON.parse(input);
const rows = data.rows ?? [];

if (rows.length === 0) {
  console.error("No rows to export");
  process.exit(1);
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const columns = Object.keys(rows[0]);
const lines = [
  columns.join(","),
  ...rows.map((row) => columns.map((col) => escapeCsv(row[col])).join(",")),
];

const outDir = "insforge/tables";
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/${tableName}.csv`;
writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${rows.length} rows to ${outPath}`);
