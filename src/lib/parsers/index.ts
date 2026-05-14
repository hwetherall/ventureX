import { parseDocx, DocxParseError } from "./docx";
import { parsePdf, PdfParseError } from "./pdf";

export const SUPPORTED_MIME_TYPES = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/**
 * D2: file types we explicitly reject in V1, with a user-facing message.
 *
 * PPTX was originally in scope (CLAUDE.md Section 7) but deferred to Phase 4
 * during eng review on 2026-05-14. The decision: PPTX parsing is unreliable
 * (text lives inside diagrams), the OCR fallback is significant work, and
 * consultants can export to PDF in seconds. We reject rather than silently
 * underperform.
 */
export const REJECTED_MIME_TYPES = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX is not supported in V1. Please export the deck to PDF and re-upload.",
  "application/vnd.ms-powerpoint":
    "Legacy PPT is not supported. Please export the deck to PDF and re-upload.",
} as const;

export interface ParseResult {
  markdown: string;
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

export class UnsupportedFileTypeError extends Error {
  constructor(
    public readonly mimeType: string,
    public readonly userMessage: string,
  ) {
    super(`Unsupported MIME type: ${mimeType}`);
    this.name = "UnsupportedFileTypeError";
  }
}

/**
 * @public
 * Dispatcher for Stage 0 document parsing.
 *
 * Returns `{ markdown, metadata?, warnings? }` on success. On unsupported
 * types, throws `UnsupportedFileTypeError` carrying a `userMessage` the
 * upload handler can surface verbatim in the UI.
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  if (mimeType in REJECTED_MIME_TYPES) {
    throw new UnsupportedFileTypeError(
      mimeType,
      REJECTED_MIME_TYPES[mimeType as keyof typeof REJECTED_MIME_TYPES],
    );
  }

  switch (mimeType) {
    case SUPPORTED_MIME_TYPES.PDF: {
      const { text, page_count, metadata } = await parsePdf(buffer);
      return {
        markdown: text,
        metadata: { ...metadata, page_count },
      };
    }
    case SUPPORTED_MIME_TYPES.DOCX: {
      const { markdown, warnings } = await parseDocx(buffer);
      return { markdown, warnings };
    }
    default: {
      throw new UnsupportedFileTypeError(
        mimeType,
        `Unsupported file type "${mimeType}". Accepted: PDF, DOCX.`,
      );
    }
  }
}

export { PdfParseError, DocxParseError };
