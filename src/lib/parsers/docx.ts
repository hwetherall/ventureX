import mammoth from "mammoth";

export interface ParsedDocx {
  /** Plain text with paragraph breaks preserved. Sufficient for LLM input. */
  markdown: string;
  warnings: string[];
}

export class DocxParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DocxParseError";
  }
}

/**
 * Parse a DOCX buffer.
 *
 * We use `extractRawText` rather than `convertToHtml` because the LLM doesn't
 * need HTML structure — paragraph breaks are enough signal for it to identify
 * sections. Embedded images are dropped silently (per CLAUDE.md Section 7
 * failure modes); mammoth surfaces warnings about them which we propagate
 * so the upload handler can log them.
 *
 * If we later need true markdown (headings, lists), swap to `convertToHtml`
 * plus an HTML-to-markdown converter like turndown.
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocx> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return {
      markdown: result.value ?? "",
      warnings: (result.messages ?? []).map((m) => m.message),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DocxParseError(`Failed to parse DOCX: ${message}`, error);
  }
}
