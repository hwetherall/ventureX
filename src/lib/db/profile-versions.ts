import type { InsForgeClient } from "@/lib/insforge/server";

// Postgres unique-violation error code. Surfaced by the InsForge SDK on the
// returned error object as `error.code`.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const POSTGRES_UNIQUE_VIOLATION = "23505";

const MAX_ATTEMPTS = 3;

export type ProfileVersionSource =
  | "llm_extracted"
  | "llm_critic"
  | "human_refined";

/**
 * @public
 * Input to {@link insertProfileVersion}. camelCase TS surface; the function
 * maps to snake_case DB columns at the boundary.
 */
export interface InsertProfileVersionInput {
  ventureId: string;
  source: ProfileVersionSource;
  profileJson: unknown;
  llmCallId?: string | null;
}

/**
 * @public
 * A row from the `profile_versions` table, returned by
 * {@link insertProfileVersion}. Field names mirror DB columns (snake_case)
 * because this is a literal row representation.
 */
export interface ProfileVersionRow {
  id: string;
  venture_id: string;
  version_number: number;
  source: ProfileVersionSource;
  profile_json: unknown;
  llm_call_id: string | null;
  created_at: string;
}

export class ProfileVersionInsertError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProfileVersionInsertError";
  }
}

/**
 * @public
 * Insert a `profile_versions` row, retrying on unique-violation (D6).
 *
 * Why retry: `profile_versions` has UNIQUE (venture_id, version_number) and we
 * compute the next version_number with `max(...) + 1`. Two concurrent HITL
 * saves (e.g., the same user with the venture open in two tabs) can compute
 * the same number, race the INSERT, and one loses. Catching error code 23505
 * and recomputing max+1 keeps both saves landing as adjacent versions instead
 * of bubbling a 500 to the user.
 *
 * MAX_ATTEMPTS = 3 covers the realistic ceiling for one user; on the rare
 * 3-tab edit storm we surface the error rather than busy-loop.
 *
 * InsForge note: `.insert()` requires array form, hence `[{ ... }]` below.
 * All chained DB ops go through `client.database` (not `client` directly).
 *
 * @throws {@link ProfileVersionInsertError} on any non-unique-violation DB
 *   error, or after exhausting MAX_ATTEMPTS unique-violation retries.
 */
export async function insertProfileVersion(
  insforge: InsForgeClient,
  input: InsertProfileVersionInput,
): Promise<ProfileVersionRow> {
  let lastUniqueViolation: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: existing, error: readError } = await insforge.database
      .from("profile_versions")
      .select("version_number")
      .eq("venture_id", input.ventureId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError) {
      throw new ProfileVersionInsertError(
        `Failed to read existing profile_versions: ${readError.message}`,
        readError,
      );
    }

    const nextVersion =
      ((existing as { version_number: number } | null)?.version_number ?? 0) +
      1;

    const { data: inserted, error: insertError } = await insforge.database
      .from("profile_versions")
      .insert([
        {
          venture_id: input.ventureId,
          version_number: nextVersion,
          source: input.source,
          profile_json: input.profileJson,
          llm_call_id: input.llmCallId ?? null,
        },
      ])
      .select()
      .single();

    if (!insertError && inserted) {
      return inserted as ProfileVersionRow;
    }

    const isUniqueViolation =
      (insertError as { code?: string } | null)?.code ===
      POSTGRES_UNIQUE_VIOLATION;

    if (isUniqueViolation && attempt < MAX_ATTEMPTS) {
      // Another writer beat us to this version_number — recompute and retry.
      lastUniqueViolation = insertError;
      continue;
    }

    // Either a non-retryable error, or we've exhausted unique-violation retries.
    throw new ProfileVersionInsertError(
      isUniqueViolation
        ? `insertProfileVersion exhausted ${MAX_ATTEMPTS} retries; concurrent writers kept winning the race`
        : `insertProfileVersion failed on attempt ${attempt}: ${insertError?.message ?? "no row returned"}`,
      insertError ?? lastUniqueViolation,
    );
  }

  // Unreachable: the loop body always returns or throws.
  throw new ProfileVersionInsertError(
    "insertProfileVersion fell through retry loop",
    lastUniqueViolation,
  );
}
