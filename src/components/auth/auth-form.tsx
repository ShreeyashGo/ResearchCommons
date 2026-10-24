"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FlaskConical } from "lucide-react";
import { isMock, signIn, signUp } from "@/lib/client/auth";
import { Button, Field, Input } from "@/components/ui/controls";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password, displayName);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (isMock()) {
    return (
      <div className="space-y-4">
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

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "signup" && (
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ada Lovelace"
            required
            autoComplete="name"
          />
        </Field>
      )}
      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lab.edu"
          required
          autoComplete="email"
        />
      </Field>
      <Field label="Password" hint={mode === "signup" ? "At least 6 characters." : undefined}>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </Field>
      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-[13px] text-muted">
        {mode === "login" ? (
          <>
            No account?{" "}
            <a href="/signup" className="font-medium text-accent hover:underline">
              Sign up
            </a>
          </>
        ) : (
          <>
            Already have one?{" "}
            <a href="/login" className="font-medium text-accent hover:underline">
              Sign in
            </a>
          </>
        )}
      </p>
    </form>
  );
}

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
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
