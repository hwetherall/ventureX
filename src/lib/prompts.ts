import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * @public
 * Thrown by {@link loadPrompt} when the requested prompt file is missing.
 *
 * Surfaces as a user-actionable error rather than a generic `ENOENT: no such
 * file or directory, open ...` trace — most callers don't care about the
 * absolute path. The orchestrators rely on the default `errorMessage` fallback
 * in their `formatErrorForUser` switches; the message here is already
 * user-facing.
 */
export class PromptFileNotFoundError extends Error {
  constructor(
    public readonly filename: string,
    public readonly absolutePath: string,
  ) {
    super(
      `Prompt file not found: prompts/${filename} (resolved to ${absolutePath}). ` +
        "The prompt may have been deleted, renamed, or not deployed. " +
        "Verify the file exists in the prompts/ directory and is committed.",
    );
    this.name = "PromptFileNotFoundError";
  }
}

/**
 * @public
 * Load a prompt file from `prompts/<filename>`. Reads on every call so prompt
 * iteration is a markdown edit, not a server restart (CLAUDE.md §14).
 *
 * Distinguishes ENOENT (the prompt file is gone — actionable) from other IO
 * errors (filesystem trouble — propagate as-is). All four stage orchestrators
 * route their prompt loads through this helper.
 *
 * @throws {@link PromptFileNotFoundError} when the file does not exist.
 * @throws Other Node IO errors propagate unchanged.
 */
export async function loadPrompt(filename: string): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", filename);
  try {
    return await fs.readFile(promptPath, "utf-8");
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      throw new PromptFileNotFoundError(filename, promptPath);
    }
    throw err;
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
