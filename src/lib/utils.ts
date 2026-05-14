import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * @public
 * Stringify an `unknown` thrown value into a user/log-safe message.
 * Prefers the `.message` of Error subclasses (including our tagged errors
 * like `StorageUploadError`, `UnsupportedFileTypeError`, `LLMValidationError`)
 * and falls back to `String()` for non-Error throws.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
