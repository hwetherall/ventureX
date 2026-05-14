import pdfParse from "pdf-parse";

export interface ParsedPdf {
  text: string;
  page_count: number;
  metadata: Record<string, unknown>;
}

export class PdfParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PdfParseError";
  }
}

/**
 * Parse a PDF buffer to plain text + metadata.
 *
 * Encrypted/password-protected PDFs surface a friendly error message rather
 * than a stack trace, so the upload handler can flag the doc as
 * `parse_error` and continue with the other documents (Stage 0 failure mode
 * per CLAUDE.md Section 7).
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  try {
    const result = await pdfParse(buffer);
    return {
      text: result.text ?? "",
      page_count: result.numpages ?? 0,
      metadata: (result.metadata as Record<string, unknown>) ?? {},
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt/i.test(message)) {
      throw new PdfParseError(
        "PDF appears to be password-protected. Please decrypt before uploading.",
        error,
      );
    }
    throw new PdfParseError(`Failed to parse PDF: ${message}`, error);
  }
}
