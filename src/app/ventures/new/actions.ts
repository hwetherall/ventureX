"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import {
  parseDocument,
  UnsupportedFileTypeError,
} from "@/lib/parsers";
import { uploadVentureDocument } from "@/lib/storage/upload";
import { errorMessage } from "@/lib/utils";

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file; pragmatic upper bound

export type CreateVentureResult =
  | { ok: true; ventureId: string }
  | { ok: false; error: string };

/**
 * Server action behind /ventures/new.
 *
 *   1. Verify the user is authenticated (RLS depends on auth.uid()).
 *   2. Validate description length and at least one file.
 *   3. Insert the ventures row at status='intake'.
 *   4. For each file: upload to InsForge Storage → insert venture_documents
 *      row → parse (Stage 0) → update the row with parsed_markdown OR
 *      parse_error.
 *   5. Transition status to 'extracting' (Stage 1 wiring lands in M7).
 *   6. Redirect to /ventures/[id].
 *
 * Per-file errors do NOT abort the whole upload — they're recorded against
 * the individual venture_documents row so the user can see which docs
 * failed without losing the others.
 */
export async function createVenture(
  formData: FormData,
): Promise<CreateVentureResult> {
  const user = await requireUser();
  const description = String(formData.get("description") ?? "").trim();

  if (!description) {
    return { ok: false, error: "Description is required." };
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Description is too long (${description.length} > ${MAX_DESCRIPTION_LENGTH} chars).`,
    };
  }

  const files = formData
    .getAll("files")
    .filter(
      (entry): entry is File => entry instanceof File && entry.size > 0,
    );

  if (files.length === 0) {
    return {
      ok: false,
      error: "Attach at least one PDF or DOCX. Description-only uploads aren't supported yet.",
    };
  }

  const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
  if (oversized) {
    return {
      ok: false,
      error: `${oversized.name} is larger than 50 MB. Split it or strip non-essential content.`,
    };
  }

  const insforge = await createAuthedServerClient();

  // 1. Create the venture row
  const { data: venture, error: ventureError } = await insforge.database
    .from("ventures")
    .insert([
      {
        created_by: user.id,
        user_provided_description: description,
        codename: "VentureX",
        status: "intake",
      },
    ])
    .select()
    .single();

  if (ventureError || !venture) {
    return {
      ok: false,
      error: `Failed to create venture: ${
        ventureError?.message ?? "no row returned"
      }`,
    };
  }

  const ventureId = (venture as { id: string }).id;

  // 2. For each file: upload + record + parse
  for (const file of files) {
    let storageKey: string | null = null;

    try {
      const { key } = await uploadVentureDocument(insforge, ventureId, file);
      storageKey = key;
    } catch (err) {
      // Per-file storage failure: record the row with parse_error and
      // continue so a single bad upload doesn't poison the whole batch.
      await insforge.database.from("venture_documents").insert([
        {
          venture_id: ventureId,
          filename: file.name,
          storage_path: "",
          mime_type: file.type,
          parse_error: errorMessage(err),
        },
      ]);
      continue;
    }

    // Record the document row (placeholder, parsed_markdown filled below)
    const { data: doc, error: docInsertError } = await insforge.database
      .from("venture_documents")
      .insert([
        {
          venture_id: ventureId,
          filename: file.name,
          storage_path: storageKey,
          mime_type: file.type,
        },
      ])
      .select()
      .single();

    if (docInsertError || !doc) {
      continue;
    }

    const docId = (doc as { id: string }).id;

    // Parse the file in-process (Stage 0). On error, stamp parse_error onto
    // the doc row but keep going.
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parseDocument(buffer, file.type);
      await insforge.database
        .from("venture_documents")
        .update({
          parsed_markdown: parsed.markdown,
          parsed_at: new Date().toISOString(),
        })
        .eq("id", docId);
    } catch (parseError) {
      // UnsupportedFileTypeError exposes a user-facing `userMessage`; for
      // everything else fall through to errorMessage().
      const message =
        parseError instanceof UnsupportedFileTypeError
          ? parseError.userMessage
          : errorMessage(parseError);
      await insforge.database
        .from("venture_documents")
        .update({ parse_error: message })
        .eq("id", docId);
    }
  }

  // 3. Transition status: intake → extracting. Stage 1 orchestration lands
  // in M7; for now the venture sits at 'extracting' awaiting that wire-up.
  await insforge.database
    .from("ventures")
    .update({ status: "extracting" })
    .eq("id", ventureId);

  redirect(`/ventures/${ventureId}`);
}
