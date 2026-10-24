import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";
import { HTTP_STATUS, type ApiError, type ErrorCode } from "@/contracts/common";

type UserClient = Awaited<ReturnType<typeof import("@/server/supabase/user").createUserClient>>;

/** Route-local helpers (the shared src/server/http module lands with the backend track). */
export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(err: HttpError): ApiError {
  return { error: { code: err.code, message: err.message, details: err.details } };
}

export function jsonError(err: HttpError): NextResponse {
  return NextResponse.json(errorBody(err), { status: HTTP_STATUS[err.code] });
}

export function toJsonError(err: unknown): NextResponse {
  if (err instanceof HttpError) return jsonError(err);
  console.error("[api] unexpected error:", err);
  return jsonError(new HttpError("internal", "internal error"));
}

export async function requireUser(supabase: UserClient) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError("unauthenticated", "sign in required");
  return data.user;
}

export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError("validation_failed", "request body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError("validation_failed", "invalid request body", parsed.error.issues);
  }
  return parsed.data;
}

/**
 * RLS-checked read: the papers row is only visible when can_read_paper() holds.
 * A missing row therefore means "not found" — we return 404 so existence isn't
 * leaked (docs/api-contracts.md).
 */
export async function requirePaperAccess(supabase: UserClient, paperId: string) {
  const { data, error } = await supabase
    .from("papers")
    .select("id,title,authors,abstract,year,arxiv_id,processing_status,processing_error")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw new HttpError("internal", `papers read failed: ${error.message}`);
  if (!data) throw new HttpError("not_found", "paper not found");
  return data;
}

/**
 * Authorization for routes that take {groupId}: the caller must be a member of
 * groupId AND the paper must be linked into that group's library. One RLS-gated
 * group_papers read proves both; anything else is a 404.
 */
export async function requireGroupPaperAccess(supabase: UserClient, paperId: string, groupId: string) {
  const { data, error } = await supabase
    .from("group_papers")
    .select("paper_id")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .maybeSingle();
  if (error) throw new HttpError("internal", `group_papers read failed: ${error.message}`);
  if (!data) throw new HttpError("not_found", "paper not found");
}
