"use client";

import { useEffect, useState } from "react";
import { ApiClientError, api, API_MOCK } from "./api";
import { createBrowserSupabaseClient } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export function isMock(): boolean {
  return API_MOCK;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (API_MOCK) {
    const { MOCK_USER } = await import("./mock/data");
    return MOCK_USER;
  }
  const supabase = createBrowserSupabaseClient();
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? "",
    displayName:
      (u.user_metadata?.display_name as string | undefined) ??
      u.email?.split("@")[0] ??
      "Researcher",
  };
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  if (API_MOCK) return {};
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message };
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<{ error?: string; needsConfirmation?: boolean }> {
  if (API_MOCK) return {};
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
    },
  });
  return {
    error: error?.message,
    needsConfirmation: !error && !data.session,
  };
}

export async function signOut(): Promise<void> {
  if (API_MOCK) return;
  const supabase = createBrowserSupabaseClient();
  await supabase.auth.signOut();
}

export async function requestPasswordReset(
  email: string,
): Promise<{ error?: string }> {
  if (API_MOCK) return {};
  const { error } = await createBrowserSupabaseClient().auth.resetPasswordForEmail(
    email,
    {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    },
  );
  return { error: error?.message };
}

export async function updatePassword(
  password: string,
): Promise<{ error?: string }> {
  if (API_MOCK) return {};
  const { error } = await createBrowserSupabaseClient().auth.updateUser({
    password,
  });
  return { error: error?.message };
}

export async function signOutEverywhere(): Promise<{ error?: string }> {
  if (API_MOCK) return {};
  const { error } = await createBrowserSupabaseClient().auth.signOut({
    scope: "global",
  });
  return { error: error?.message };
}

export async function updateDisplayName(
  name: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await api.updateMe({ displayName: name });
    if (!API_MOCK) {
      await createBrowserSupabaseClient().auth
        .updateUser({ data: { display_name: profile.displayName } })
        .catch(() => null);
    }
    window.dispatchEvent(new Event("rc:session-user-changed"));
    return {};
  } catch (error) {
    return {
      error:
        error instanceof ApiClientError
          ? error.message
          : "Unable to update profile.",
    };
  }
}

export function useSessionUser(): { user: SessionUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; loading: boolean }>({
    user: null,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getSessionUser()
        .then((user) => {
          if (alive) setState({ user, loading: false });
        })
        .catch(() => {
          if (alive) setState({ user: null, loading: false });
        });
    };
    window.addEventListener("rc:session-user-changed", refresh);
    refresh();
    return () => {
      alive = false;
      window.removeEventListener("rc:session-user-changed", refresh);
    };
  }, []);
  return state;
}
