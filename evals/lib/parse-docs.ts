/**
 * Document loader for eval cases. Walks a case's `documents_dir`, parses
 * every PDF/DOCX it finds via the production parsers, and returns the same
 * `{ filename, markdown }` shape the orchestrators use internally.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseDocument } from "@/lib/parsers";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface ParsedEvalDoc {
  filename: string;
  markdown: string;
}

function mimeForExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return PDF_MIME;
  if (ext === ".docx") return DOCX_MIME;
  return null;
}

export async function loadCaseDocuments(
  documentsDir: string,
): Promise<{ docs: ParsedEvalDoc[]; warnings: string[] }> {
  const warnings: string[] = [];
  const absDir = path.resolve(documentsDir);

  let entries: string[];
  try {
    entries = await fs.readdir(absDir);
  } catch (err) {
    throw new Error(
      `Could not read case documents_dir ${absDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const docs: ParsedEvalDoc[] = [];
  for (const filename of entries) {
    const mime = mimeForExtension(filename);
    if (!mime) continue;
    const buffer = await fs.readFile(path.join(absDir, filename));
    try {
      const result = await parseDocument(buffer, mime);
      docs.push({ filename, markdown: result.markdown });
    } catch (err) {
      warnings.push(
        `${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { docs, warnings };
}
