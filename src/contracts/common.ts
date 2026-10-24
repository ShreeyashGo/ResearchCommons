import { z } from "zod";

export const Uuid = z.string().uuid();
export const IsoDate = z.string().datetime({ offset: true });

export const ErrorCode = z.enum([
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "upstream_failed",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every non-2xx response body. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const HTTP_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  upstream_failed: 502,
  rate_limited: 429,
  internal: 500,
};

export const ProfileSummary = z.object({ id: Uuid, displayName: z.string() });
export type ProfileSummary = z.infer<typeof ProfileSummary>;
