"use client";

import { useEffect, useState } from "react";
import { API_MOCK } from "./api";
import { MOCK_USER } from "./mock/data";
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
  if (API_MOCK) return MOCK_USER;
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
): Promise<{ error?: string }> {
  if (API_MOCK) return {};
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  return { error: error?.message };
}

export async function signOut(): Promise<void> {
  if (API_MOCK) return;
  const supabase = createBrowserSupabaseClient();
  await supabase.auth.signOut();
}

export function useSessionUser(): { user: SessionUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; loading: boolean }>({
    user: null,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    getSessionUser().then((user) => {
      if (alive) setState({ user, loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
