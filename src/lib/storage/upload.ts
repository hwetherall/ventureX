import type { InsForgeClient } from "@/lib/insforge/server";

export const VENTURE_DOCUMENTS_BUCKET = "venture-documents";

export interface UploadedDocument {
  /** Storage key — what we persist into venture_documents.storage_path. */
  key: string;
  /** Public or signed URL, depending on bucket visibility. May be empty. */
  url: string;
}

export class StorageUploadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageUploadError";
  }
}

/**
 * Upload a venture document to InsForge Storage.
 *
 * Path convention: `<venture_id>/<timestamp>-<safe-filename>`. The folder
 * prefix matches the storage RLS policy (which restricts read/write to
 * objects under a folder owned by the requesting user's venture).
 *
 * Per the InsForge SDK conventions, we save both the `key` and `url` to
 * the database so we can support downloads and deletes later.
 */
export async function uploadVentureDocument(
  insforge: InsForgeClient,
  ventureId: string,
  file: File,
): Promise<UploadedDocument> {
  // Sanitize filename: allow word chars, dots, hyphens. Replace everything
  // else with `_` to keep storage paths clean.
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const key = `${ventureId}/${Date.now()}-${safeName}`;

  const { data, error } = await insforge.storage
    .from(VENTURE_DOCUMENTS_BUCKET)
    .upload(key, file);

  if (error || !data) {
    throw new StorageUploadError(
      `Storage upload failed for "${file.name}": ${
        error?.message ?? "no data returned"
      }`,
      error,
    );
  }

  // The SDK response shape may surface either `key`/`url` directly or a
  // nested `path`/`fullPath` depending on version. Read both leniently.
  const responseAsRecord = data as Record<string, unknown>;
  return {
    key: (responseAsRecord.key as string) ?? (responseAsRecord.path as string) ?? key,
    url: (responseAsRecord.url as string) ?? "",
  };
}
