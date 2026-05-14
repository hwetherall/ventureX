"use client";

import { useRef, useState, useTransition } from "react";
import { createVenture } from "./actions";

const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const REJECTED_HINTS: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX isn't supported in V1 — export to PDF and re-attach.",
  "application/vnd.ms-powerpoint":
    "Legacy PPT isn't supported — export to PDF and re-attach.",
};

export function NewVentureForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isPending, startTransition] = useTransition();

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const picked = Array.from(e.target.files ?? []);

    // Catch rejected types client-side so the user doesn't wait for a
    // server round-trip just to learn PPTX won't work.
    const blocker = picked.find((f) => f.type in REJECTED_HINTS);
    if (blocker) {
      setError(REJECTED_HINTS[blocker.type] ?? "Unsupported file type.");
      e.target.value = "";
      setSelectedFiles([]);
      return;
    }

    setSelectedFiles(picked);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createVenture(formData);
        if (!result.ok) {
          setError(result.error);
        }
      } catch (err) {
        // Server actions that redirect throw NEXT_REDIRECT internally;
        // surface only real errors to the user.
        if (
          err instanceof Error &&
          err.message.includes("NEXT_REDIRECT")
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Unexpected error.");
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="mt-8 space-y-6"
    >
      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Venture description
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          One paragraph or two. What the venture is, who's behind it, what
          they're trying to build. Anonymized framing is fine.
        </p>
        <textarea
          id="description"
          name="description"
          required
          rows={6}
          maxLength={4000}
          placeholder="A new product line entering rack-level power distribution for data centers, backed by..."
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label htmlFor="files" className="block text-sm font-medium">
          Supporting documents
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF or DOCX. PPTX must be exported to PDF first. Max 50 MB per file.
        </p>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept={ACCEPTED_MIME_TYPES.join(",")}
          onChange={onFilesChange}
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
        />

        {selectedFiles.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {selectedFiles.map((f) => (
              <li key={f.name} className="flex justify-between gap-3">
                <span className="truncate">{f.name}</span>
                <span>{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {isPending
            ? "Uploading and parsing — this can take 10-30 seconds for typical case briefs..."
            : selectedFiles.length > 0
              ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} ready`
              : "No files attached yet"}
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {isPending ? "Working..." : "Create venture"}
        </button>
      </div>
    </form>
  );
}
