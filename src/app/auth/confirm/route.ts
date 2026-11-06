import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth-redirect";
import { createUserClient } from "@/server/supabase/user";

const allowedTypes: readonly EmailOtpType[] = [
  "email",
  "signup",
  "recovery",
  "email_change",
  "invite",
  "magiclink",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));
  const invalidLink = () =>
    NextResponse.redirect(new URL("/login?error=link", url.origin));

  if (!tokenHash || !type || !allowedTypes.includes(type)) {
    return invalidLink();
  }

  try {
    const { error } = await (
      await createUserClient()
    ).auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return invalidLink();
    return NextResponse.redirect(new URL(next, url.origin));
  } catch {
    return invalidLink();
  }
}
