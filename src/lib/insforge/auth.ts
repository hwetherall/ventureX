import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createAuthedServerClient,
} from "./server";

export interface InsForgeUser {
  id: string;
  email: string;
  [key: string]: unknown;
}

/**
 * Read the current user from the session cookie. Returns null if there's no
 * session or the token is invalid. Safe to call from any server context.
 */
export async function getCurrentUser(): Promise<InsForgeUser | null> {
  const insforge = await createAuthedServerClient();
  const { data, error } = await insforge.auth.getCurrentUser();
  if (error || !data?.user) return null;
  return data.user as InsForgeUser;
}

/**
 * Require an authenticated user. Redirects to /login if there's no session.
 * Use from Server Components and server actions on protected routes.
 */
export async function requireUser(): Promise<InsForgeUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Wipe the session cookies. Server actions and route handlers that sign the
 * user out should call this and then redirect.
 */
export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}
