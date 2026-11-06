"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FlaskConical } from "lucide-react";
import {
  getSessionUser,
  isMock,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from "@/lib/client/auth";
import { Button, Field, Input } from "@/components/ui/controls";

export type AuthMode = "login" | "signup" | "forgot" | "reset";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [recoverySent, setRecoverySent] = useState(false);
  const [resetAccess, setResetAccess] = useState<"checking" | "valid" | "invalid">(
    mode === "reset" ? "checking" : "valid",
  );

  useEffect(() => {
    if (mode === "login" && new URLSearchParams(window.location.search).get("error") === "link") {
      setError("That link is invalid or has expired.");
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "reset") return;
    let alive = true;
    void getSessionUser()
      .then((user) => {
        if (alive) setResetAccess(user ? "valid" : "invalid");
      })
      .catch(() => {
        if (alive) setResetAccess("invalid");
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email).catch(() => ({}));
        setRecoverySent(true);
        return;
      }

      if (mode === "reset") {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
        const result = await updatePassword(password);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.replace("/");
        return;
      }

      if (mode === "signup") {
        const result = await signUp(email, password, displayName);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.needsConfirmation) {
          setConfirmationEmail(email);
          return;
        }
      } else {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset" && resetAccess === "checking") {
    return <p className="text-sm text-muted">Checking your reset link…</p>;
  }

  if (mode === "reset" && resetAccess === "invalid") {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          This reset link is invalid or has expired.
        </p>
        <a href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
          Request another reset link
        </a>
      </div>
    );
  }

  if (mode === "signup" && confirmationEmail) {
    return (
      <div className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-ink">Check your email</h2>
        <p className="text-sm leading-6 text-muted">
          We sent a confirmation link to {confirmationEmail}&hellip;
        </p>
        <a href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  if (isMock() && (mode === "login" || mode === "signup")) {
    return (
      <div className="space-y-4">
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
        )}
        <div className="rounded-lg border border-accent/30 bg-accent-soft p-3 text-[13px] leading-5 text-accent-strong">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <FlaskConical size={14} /> Mock API mode
          </span>
          <p className="mt-1">
            The backend isn&apos;t wired up yet — continuing signs you in as the fixture user
            Ada Lovelace against an in-memory API.
          </p>
        </div>
        <Button className="w-full" onClick={() => router.replace("/")}>
          Continue as Ada Lovelace
        </Button>
      </div>
    );
  }

  if (mode === "forgot" && recoverySent) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm leading-6 text-ink">
          If an account exists for that email, we&apos;ve sent a reset link.
        </p>
        {isMock() && <p className="text-xs text-muted">Email isn&apos;t sent in mock mode.</p>}
        <a href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {(mode === "forgot" || mode === "reset") && isMock() && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft p-3 text-[13px] leading-5 text-accent-strong">
          {mode === "forgot"
            ? "Email isn’t sent in mock mode."
            : "Password updates aren’t available in mock mode."}
        </div>
      )}
      {mode === "signup" && (
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Ada Lovelace"
            required
            autoComplete="name"
          />
        </Field>
      )}
      {(mode === "login" || mode === "signup" || mode === "forgot") && (
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@lab.edu"
            required
            autoComplete="email"
          />
        </Field>
      )}
      {mode !== "forgot" && (
        <Field label={mode === "reset" ? "New password" : "Password"} hint={mode === "signup" ? "At least 6 characters." : undefined}>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
        </Field>
      )}
      {mode === "reset" && (
        <Field label="Confirm password">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </Field>
      )}
      {mode === "login" && (
        <p className="-mt-2 text-right text-xs">
          <a href="/forgot-password" className="font-medium text-accent hover:underline">
            Forgot password?
          </a>
        </p>
      )}
      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? "…"
          : mode === "login"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : mode === "forgot"
                ? "Send reset link"
                : "Update password"}
      </Button>
      <p className="text-center text-[13px] text-muted">
        {mode === "login" ? (
          <>
            No account?{" "}
            <a href="/signup" className="font-medium text-accent hover:underline">
              Sign up
            </a>
          </>
        ) : mode === "signup" ? (
          <>
            Already have one?{" "}
            <a href="/login" className="font-medium text-accent hover:underline">
              Sign in
            </a>
          </>
        ) : (
          <a href="/login" className="font-medium text-accent hover:underline">
            Back to sign in
          </a>
        )}
      </p>
    </form>
  );
}

export function AuthCard({ mode }: { mode: AuthMode }) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
          <BookOpen size={18} />
        </span>
        <div>
          <p className="font-serif text-lg font-semibold leading-tight text-ink">Research Commons</p>
          <p className="text-xs text-muted">Read together. Cite smarter.</p>
        </div>
      </div>
      <AuthForm mode={mode} />
    </div>
  );
}
