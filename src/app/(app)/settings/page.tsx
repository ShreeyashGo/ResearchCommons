"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/controls";
import {
  isMock,
  signOutEverywhere,
  updateDisplayName,
  updatePassword,
  useSessionUser,
} from "@/lib/client/auth";

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useSessionUser();
  const [displayName, setDisplayName] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const mock = isMock();

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.displayName]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileMessage(null);
    const result = await updateDisplayName(displayName);
    setProfileError(Boolean(result.error));
    setProfileMessage(result.error ?? "Display name saved.");
    setProfileBusy(false);
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);
    setPasswordError(false);
    if (password !== confirmPassword) {
      setPasswordError(true);
      setPasswordMessage("Passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    const result = await updatePassword(password);
    setPasswordError(Boolean(result.error));
    setPasswordMessage(result.error ?? "Password updated.");
    if (!result.error) {
      setPassword("");
      setConfirmPassword("");
    }
    setPasswordBusy(false);
  }

  async function signOutAll() {
    setSigningOut(true);
    setSessionError(null);
    const result = await signOutEverywhere();
    if (result.error) {
      setSessionError(result.error);
      setSigningOut(false);
      return;
    }
    router.replace("/login");
  }

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-8 sm:px-10 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Account</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-ink">Settings</h1>
        </header>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-serif text-lg font-semibold text-ink">Profile</h2>
          <p className="mt-1 text-sm text-muted">Update the name shown to your group.</p>
          <form onSubmit={saveProfile} className="mt-5 space-y-4">
            <Field label="Display name">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={80}
                autoComplete="name"
              />
            </Field>
            {profileMessage && (
              <p className={`text-sm ${profileError ? "text-danger" : "text-accent-strong"}`}>
                {profileMessage}
              </p>
            )}
            <Button type="submit" size="sm" disabled={profileBusy}>
              {profileBusy ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-serif text-lg font-semibold text-ink">Password</h2>
          <form onSubmit={savePassword} className="mt-5 space-y-4">
            <fieldset disabled={mock} className="space-y-4 disabled:opacity-50">
              <Field label="New password">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={6}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Button type="submit" size="sm" disabled={passwordBusy}>
                {passwordBusy ? "Updating…" : "Update password"}
              </Button>
            </fieldset>
            {mock && <p className="mt-3 text-xs text-muted">Not available in mock mode.</p>}
            {passwordMessage && (
              <p className={`text-sm ${passwordError ? "text-danger" : "text-accent-strong"}`}>
                {passwordMessage}
              </p>
            )}
          </form>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-serif text-lg font-semibold text-ink">Sessions</h2>
          <p className="mt-1 text-sm text-muted">
            Sign out of every device currently connected to your account.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={mock || signingOut}
            onClick={() => void signOutAll()}
          >
            {signingOut ? "Signing out…" : "Sign out everywhere"}
          </Button>
          {mock && <p className="mt-3 text-xs text-muted">Not available in mock mode.</p>}
          {sessionError && <p className="mt-3 text-sm text-danger">{sessionError}</p>}
        </section>
      </div>
    </div>
  );
}
