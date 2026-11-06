import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors";
import { routeHandler } from "../handler";
import { enforceRateLimit, rateLimitsFor } from "../rate-limit";

const allowed = { data: [{ allowed: true, retry_after: 0 }], error: null };

function fakeSupabase() {
  const rpc = vi.fn().mockResolvedValue(allowed);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enforceRateLimit", () => {
  it("returns default limits in day-then-minute order", () => {
    expect(rateLimitsFor("import", env({}))).toEqual([
      { window: "day", limit: 100 },
      { window: "min", limit: 10 },
    ]);
  });

  it("resolves when all windows allow the request", async () => {
    const { supabase, rpc } = fakeSupabase();

    await expect(enforceRateLimit(supabase, "ask")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "hit_rate_limit", {
      p_bucket: "ask:day",
      p_limit: 200,
      p_window_seconds: 86_400,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 20,
      p_window_seconds: 60,
    });
  });

  it("throws rate_limited with retry details when denied", async () => {
    const { supabase, rpc } = fakeSupabase();
    rpc.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 17 }],
      error: null,
    });

    await expect(enforceRateLimit(supabase, "summary")).rejects.toMatchObject({
      code: "rate_limited",
      message: "Too many requests. Try again in 17s.",
      details: { retryAfter: 17 },
    });
  });

  it("does not check the minute window after the day window denies", async () => {
    const { supabase, rpc } = fakeSupabase();
    rpc.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 12 }],
      error: null,
    });

    await expect(enforceRateLimit(supabase, "ask")).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("hit_rate_limit", {
      p_bucket: "ask:day",
      p_limit: 200,
      p_window_seconds: 86_400,
    });
  });

  it("uses environment overrides and can add a default-absent window", async () => {
    const { supabase, rpc } = fakeSupabase();

    await enforceRateLimit(
      supabase,
      "summary",
      env({
        RATE_LIMIT_SUMMARY_PER_MIN: "8",
        RATE_LIMIT_SUMMARY_PER_DAY: "50",
      }),
    );

    expect(rpc).toHaveBeenNthCalledWith(1, "hit_rate_limit", {
      p_bucket: "summary:day",
      p_limit: 50,
      p_window_seconds: 86_400,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "hit_rate_limit", {
      p_bucket: "summary:min",
      p_limit: 8,
      p_window_seconds: 60,
    });
  });

  it("skips windows overridden to zero", async () => {
    const { supabase, rpc } = fakeSupabase();

    await enforceRateLimit(
      supabase,
      "ask",
      env({ RATE_LIMIT_ASK_PER_MIN: "0" }),
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("hit_rate_limit", {
      p_bucket: "ask:day",
      p_limit: 200,
      p_window_seconds: 86_400,
    });
  });

  it("ignores invalid environment values and keeps the default", async () => {
    const { supabase, rpc } = fakeSupabase();

    await enforceRateLimit(
      supabase,
      "summary",
      env({ RATE_LIMIT_SUMMARY_PER_MIN: "not-a-number" }),
    );

    expect(rpc).toHaveBeenCalledWith("hit_rate_limit", {
      p_bucket: "summary:min",
      p_limit: 30,
      p_window_seconds: 60,
    });
  });

  it("allows requests when the RPC reports an error", async () => {
    const { supabase, rpc } = fakeSupabase();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: new Error("database down") });

    await expect(enforceRateLimit(supabase, "summary")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[rate-limit] summary:min RPC failed; allowing request",
      expect.any(Error),
    );
  });
});

describe("routeHandler rate-limit responses", () => {
  it("returns 429 with Retry-After for rate_limited errors", async () => {
    const handler = routeHandler<{ pid: string }>(async () => {
      throw new HttpError(
        "rate_limited",
        "Too many requests. Try again in 42s.",
        { retryAfter: 42 },
      );
    });

    const response = await handler(new NextRequest("http://localhost/api/test"), {
      params: Promise.resolve({ pid: "paper-1" }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "rate_limited", details: { retryAfter: 42 } },
    });
  });
});
