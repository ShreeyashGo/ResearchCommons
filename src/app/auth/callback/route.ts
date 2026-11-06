import { NextResponse } from "next/server";
import { createUserClient } from "@/server/supabase/user";
import { safeNextPath } from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const hasAuthError =
    url.searchParams.has("error") || url.searchParams.has("error_description");

  if (!code || hasAuthError) {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }

  const { error } = await (await createUserClient()).auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
