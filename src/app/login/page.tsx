"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  resendVerification,
  signIn,
  signUp,
  verifyEmail,
} from "./actions";

type Mode = "signin" | "signup" | "verify";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [verifyEmailAddress, setVerifyEmailAddress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const otpRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the OTP input when entering verify mode — small UX nicety
  // that matters because the user just glanced at their email client and
  // needs to start typing immediately.
  useEffect(() => {
    if (mode === "verify") {
      otpRef.current?.focus();
    }
  }, [mode]);

  function handleSubmit(formData: FormData) {
    setError(null);
    setInfo(null);

    startTransition(async () => {
      try {
        if (mode === "verify") {
          const otp = String(formData.get("otp") ?? "");
          const result = await verifyEmail(verifyEmailAddress, otp);
          if (!result.ok) setError(result.error);
          return;
        }

        if (mode === "signin") {
          const result = await signIn(formData);
          if (!result.ok) {
            if ("needsVerification" in result && result.needsVerification) {
              setVerifyEmailAddress(result.email);
              setMode("verify");
              setInfo(
                "This account isn't verified yet. Enter the code from your email.",
              );
            } else {
              setError(result.error);
            }
          }
          return;
        }

        // mode === "signup"
        const result = await signUp(formData);
        if (result.ok) {
          if (result.requireVerification) {
            setVerifyEmailAddress(result.email);
            setMode("verify");
            setInfo(
              `We sent a 6-digit code to ${result.email}. Enter it below to finish signing up.`,
            );
          }
        } else {
          setError(result.error);
        }
      } catch (err) {
        // Server actions that redirect throw NEXT_REDIRECT — that's success,
        // not an error, and we shouldn't surface it.
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

  function handleResend() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await resendVerification(verifyEmailAddress);
      if (result.ok) {
        setInfo(result.info);
      } else {
        setError(result.error);
      }
    });
  }

  function handleBackFromVerify() {
    setMode("signin");
    setVerifyEmailAddress("");
    setError(null);
    setInfo(null);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">VentureX</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "signin" && "Sign in to your account"}
        {mode === "signup" && "Create an account"}
        {mode === "verify" && "Verify your email"}
      </p>

      {mode === "verify" ? (
        <VerifyForm
          email={verifyEmailAddress}
          info={info}
          error={error}
          isPending={isPending}
          otpRef={otpRef}
          onSubmit={handleSubmit}
          onResend={handleResend}
          onBack={handleBackFromVerify}
        />
      ) : (
        <SignInOrUpForm
          mode={mode}
          info={info}
          error={error}
          isPending={isPending}
          onSubmit={handleSubmit}
          onModeToggle={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface SignInOrUpFormProps {
  mode: "signin" | "signup";
  info: string | null;
  error: string | null;
  isPending: boolean;
  onSubmit: (formData: FormData) => void;
  onModeToggle: () => void;
}

function SignInOrUpForm({
  mode,
  info,
  error,
  isPending,
  onSubmit,
  onModeToggle,
}: SignInOrUpFormProps) {
  return (
    <>
      <form action={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {info && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-foreground py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {isPending ? "..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>

      <button
        type="button"
        onClick={onModeToggle}
        className="mt-4 text-sm underline underline-offset-4"
      >
        {mode === "signin"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </>
  );
}

interface VerifyFormProps {
  email: string;
  info: string | null;
  error: string | null;
  isPending: boolean;
  otpRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (formData: FormData) => void;
  onResend: () => void;
  onBack: () => void;
}

function VerifyForm({
  email,
  info,
  error,
  isPending,
  otpRef,
  onSubmit,
  onResend,
  onBack,
}: VerifyFormProps) {
  return (
    <>
      <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-xs">
        Verifying <span className="font-medium">{email}</span>
      </div>

      <form action={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="otp" className="block text-sm font-medium">
            6-digit code
          </label>
          <input
            ref={otpRef}
            id="otp"
            name="otp"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            minLength={6}
            required
            autoComplete="one-time-code"
            placeholder="123456"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {info && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-foreground py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {isPending ? "..." : "Verify and sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onResend}
          disabled={isPending}
          className="underline underline-offset-4 disabled:opacity-50"
        >
          Resend code
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="text-muted-foreground underline underline-offset-4 disabled:opacity-50"
        >
          Use a different email
        </button>
      </div>
    </>
  );
}
