import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./errors";

export type RateBucket = "ask" | "summary" | "explain" | "import" | "process";

const WINDOWS = { min: 60, day: 86_400 } as const;
type RateWindow = keyof typeof WINDOWS;

const DEFAULTS: Record<RateBucket, Partial<Record<RateWindow, number>>> = {
  ask: { min: 20, day: 200 },
  summary: { min: 30 },
  explain: { min: 30 },
  import: { min: 10, day: 100 },
  process: { min: 5 },
};

export function rateLimitsFor(
  bucket: RateBucket,
  env: NodeJS.ProcessEnv = process.env,
): Array<{ window: RateWindow; limit: number }> {
  const limits: Partial<Record<RateWindow, number>> = {
    ...DEFAULTS[bucket],
  };
  for (const window of ["day", "min"] as const) {
    const value = env[
      `RATE_LIMIT_${bucket.toUpperCase()}_PER_${window.toUpperCase()}`
    ]?.trim();
    if (value === undefined || !/^\d+$/.test(value)) continue;
    const limit = Number(value);
    if (Number.isSafeInteger(limit)) limits[window] = limit;
  }

  return (["day", "min"] as const).flatMap((window) => {
    const limit = limits[window];
    return limit === undefined || limit === 0 ? [] : [{ window, limit }];
  });
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  bucket: RateBucket,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  for (const { window, limit } of rateLimitsFor(bucket, env)) {
    let data: unknown;
    let error: unknown;
    try {
      const response = await supabase.rpc("hit_rate_limit", {
        p_bucket: `${bucket}:${window}`,
        p_limit: limit,
        p_window_seconds: WINDOWS[window],
      });
      data = response.data;
      error = response.error;
    } catch (rpcError) {
      console.warn(
        `[rate-limit] ${bucket}:${window} RPC failed; allowing request`,
        rpcError,
      );
      continue;
    }

    if (error) {
      console.warn(
        `[rate-limit] ${bucket}:${window} RPC failed; allowing request`,
        error,
      );
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") {
      console.warn(
        `[rate-limit] ${bucket}:${window} RPC returned no row; allowing request`,
      );
      continue;
    }
    const result = row as { allowed?: unknown; retry_after?: unknown };
    if (typeof result.allowed !== "boolean") {
      console.warn(
        `[rate-limit] ${bucket}:${window} RPC returned an invalid row; allowing request`,
      );
      continue;
    }
    if (result.allowed) continue;

    const retryAfter = result.retry_after;
    if (
      typeof retryAfter !== "number" ||
      !Number.isInteger(retryAfter) ||
      retryAfter < 0
    ) {
      console.warn(
        `[rate-limit] ${bucket}:${window} RPC returned an invalid retry_after; allowing request`,
      );
      continue;
    }
    throw new HttpError(
      "rate_limited",
      `Too many requests. Try again in ${retryAfter}s.`,
      { retryAfter },
    );
  }
}
