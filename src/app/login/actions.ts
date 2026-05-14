"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearAuthCookies } from "@/lib/insforge/auth";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createInsForgeServerClient,
} from "@/lib/insforge/server";

const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15; // 15 min
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

async function setAuthCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...authCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...authCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────────────

/** Success cases redirect (throwing NEXT_REDIRECT). Result types only model failure / pending states. */
export type SignInResult =
  | { ok: false; error: string }
  | { ok: false; error: string; needsVerification: true; email: string };

export type SignUpResult =
  | { ok: false; error: string }
  | { ok: true; requireVerification: true; email: string };

export type VerifyResult = { ok: false; error: string };

export type ResendResult =
  | { ok: true; info: string }
  | { ok: false; error: string };

// Used by /logout and similar.
export type AuthActionResult = { ok: true } | { ok: false; error: string };

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function looksLikeUnverifiedError(err: {
  message?: string;
  statusCode?: number;
}): boolean {
  if (err.statusCode === 403) return true;
  if (!err.message) return false;
  return /not verif|verify your email|email.*verif/i.test(err.message);
}

// ────────────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────────────

export async function signIn(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const insforge = createInsForgeServerClient();
  const { data, error } = await insforge.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // InsForge returns 403 (or a "not verified" message) when the account
    // exists but the email hasn't been confirmed yet. Surface a special
    // result so the UI can jump straight to the verification step.
    if (looksLikeUnverifiedError(error as { message?: string; statusCode?: number })) {
      return {
        ok: false,
        error: "This email hasn't been verified yet. Enter the code we just sent.",
        needsVerification: true,
        email,
      };
    }
    return { ok: false, error: error.message ?? "Sign in failed." };
  }

  if (!data?.accessToken || !data?.refreshToken) {
    return { ok: false, error: "Sign in returned no session. Try again." };
  }

  await setAuthCookies(data.accessToken, data.refreshToken);
  redirect("/");
}

export async function signUp(formData: FormData): Promise<SignUpResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const insforge = createInsForgeServerClient();
  const { data, error } = await insforge.auth.signUp({ email, password });

  if (error) {
    return { ok: false, error: error.message ?? "Sign up failed." };
  }

  // Branch on the project's email-verification config (code vs link). The
  // project this is wired up to is "code" mode, so we hand off to the
  // verify-OTP step. For link mode, the same UI shows a "check your email"
  // hint and the user comes back via redirectTo.
  if (data?.requireEmailVerification) {
    return { ok: true, requireVerification: true, email };
  }

  // Verification disabled at the project level: tokens come back inline
  // and the user is signed in immediately.
  if (data?.accessToken && data?.refreshToken) {
    await setAuthCookies(data.accessToken, data.refreshToken);
    redirect("/");
  }

  return {
    ok: false,
    error: "Sign-up returned an unexpected response. Try signing in.",
  };
}

export async function verifyEmail(
  email: string,
  otp: string,
): Promise<VerifyResult> {
  const cleanedEmail = email.trim();
  const cleanedOtp = otp.replace(/\s+/g, "");

  if (!cleanedEmail || !cleanedOtp) {
    return { ok: false, error: "Email and verification code are required." };
  }
  if (!/^\d{6}$/.test(cleanedOtp)) {
    return { ok: false, error: "Code must be 6 digits." };
  }

  const insforge = createInsForgeServerClient();
  const { data, error } = await insforge.auth.verifyEmail({
    email: cleanedEmail,
    otp: cleanedOtp,
  });

  if (error) {
    // InsForge returns 400 for invalid/expired codes per the SDK doc.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 400) {
      return {
        ok: false,
        error: "That code is invalid or has expired. Resend a new one and try again.",
      };
    }
    return { ok: false, error: error.message ?? "Verification failed." };
  }

  if (!data?.accessToken || !data?.refreshToken) {
    return {
      ok: false,
      error:
        "Verification succeeded but no session returned. Try signing in.",
    };
  }

  await setAuthCookies(data.accessToken, data.refreshToken);
  redirect("/");
}

export async function resendVerification(
  email: string,
): Promise<ResendResult> {
  const cleanedEmail = email.trim();
  if (!cleanedEmail) {
    return { ok: false, error: "Email is required." };
  }

  const insforge = createInsForgeServerClient();
  const { error } = await insforge.auth.resendVerificationEmail({
    email: cleanedEmail,
  });

  if (error) {
    return { ok: false, error: error.message ?? "Resend failed." };
  }
  return { ok: true, info: "Sent. Check your inbox for a new code." };
}

export async function signOut(): Promise<void> {
  await clearAuthCookies();
  redirect("/login");
}
