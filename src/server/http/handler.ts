import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { Uuid } from "@/contracts/common";
import { createUserClient } from "@/server/supabase/user";
import {
  HttpError,
  internal,
  notFound,
  unauthenticated,
  validationFailed,
} from "@/server/http/errors";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type RouteContext<Params = Record<string, string>> = {
  params: Promise<Params>;
};

export type Session = { supabase: SupabaseClient; user: User };

/** Authenticate the request via the session cookie; 401 when signed out. */
export async function requireUser(): Promise<Session> {
  const supabase = await createUserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw unauthenticated();
  }
  return { supabase, user };
}

/** Parse the JSON request body against a zod contract schema. */
export async function parseJson<Schema extends z.ZodTypeAny>(
  req: NextRequest,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw validationFailed("Request body must be valid JSON.");
  }
  return schema.parse(body);
}

/** Validate a uuid path param; malformed ids are a 404, not a 422. */
export function uuidParam(value: string): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success) {
    throw notFound("Resource not found.");
  }
  return parsed.data;
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(error.toBody(), { status: error.status });
  }
  if (error instanceof ZodError) {
    const httpError = validationFailed("Request failed validation.", error.issues);
    return NextResponse.json(httpError.toBody(), { status: httpError.status });
  }
  console.error("Unhandled route error:", error);
  const httpError = internal();
  return NextResponse.json(httpError.toBody(), { status: httpError.status });
}

/**
 * Wrap a route handler so thrown HttpError/ZodError map to the ApiError
 * contract and anything else becomes a 500.
 */
export function routeHandler<Params>(
  handler: (
    req: NextRequest,
    ctx: RouteContext<Params>,
  ) => Promise<Response>,
) {
  return async (
    req: NextRequest,
    ctx: RouteContext<Params>,
  ): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
