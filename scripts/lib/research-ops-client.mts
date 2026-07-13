import { createClient } from "@insforge/sdk";

export async function makeResearchOpsClient() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey =
    process.env.INSFORGE_ANON_KEY ??
    process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!baseUrl || !anonKey) {
    throw new Error("NEXT_PUBLIC_INSFORGE_URL and INSFORGE_ANON_KEY are required");
  }

  const email = process.env.VENTUREX_EMAIL;
  const password = process.env.VENTUREX_PASSWORD;
  if (email && password) {
    const anon = createClient({ baseUrl, anonKey, isServerMode: true });
    const { data: session, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !session?.accessToken) {
      throw new Error(`VentureX sign-in failed: ${error?.message ?? "no token"}`);
    }
    return createClient({
      baseUrl,
      anonKey,
      isServerMode: true,
      edgeFunctionToken: session.accessToken,
    });
  }

  const adminKey = process.env.INSFORGE_API_KEY;
  if (!adminKey) {
    throw new Error(
      "Set VENTUREX_EMAIL + VENTUREX_PASSWORD or INSFORGE_API_KEY for research scripts.",
    );
  }
  return createClient({ baseUrl, anonKey: adminKey, isServerMode: true });
}
