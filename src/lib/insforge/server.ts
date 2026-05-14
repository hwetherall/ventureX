import { createClient } from "@insforge/sdk";
import { cookies } from "next/headers";

/**
 * Cookie names used to persist the InsForge session on the server.
 *
 * Unlike Supabase's SSR helper, the InsForge SDK does NOT manage cookies
 * for us — we set/read them in server actions and route handlers and pass
 * the access token to `createInsForgeServerClient` as `edgeFunctionToken`.
 */
export const ACCESS_TOKEN_COOKIE = "insforge_access_token";
export const REFRESH_TOKEN_COOKIE = "insforge_refresh_token";

export type InsForgeClient = ReturnType<typeof createClient>;

/**
 * Create an InsForge client for use in server actions, Server Components,
 * and route handlers. Pass an `accessToken` for authenticated requests
 * (RLS sees `auth.uid()` correctly); omit for unauthenticated public flows
 * like sign-up.
 */
export function createInsForgeServerClient(
  accessToken?: string,
): InsForgeClient {
  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_ANON_KEY!,
    isServerMode: true,
    edgeFunctionToken: accessToken,
  });
}

/**
 * Convenience: read the access token from request cookies and return an
 * authenticated InsForge client. If no session cookie is present, returns
 * an unauthenticated client (RLS will scope reads to "no rows visible").
 *
 * Use this from server actions and route handlers when the caller is the
 * end user. For system-level tasks that need to bypass RLS, see the
 * (future) `createInsForgeAdminClient` factory in this module.
 */
export async function createAuthedServerClient(): Promise<InsForgeClient> {
  const accessToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  return createInsForgeServerClient(accessToken);
}
