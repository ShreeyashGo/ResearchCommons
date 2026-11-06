import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestUser = { id: string; client: SupabaseClient };

const rlsTestsEnabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the rate-limit RLS tests.");
  }
};

describe.skipIf(!rlsTestsEnabled)("rate-limit RLS and RPC", () => {
  let admin: SupabaseClient | undefined;
  let anonymous: SupabaseClient | undefined;
  const users: TestUser[] = [];

  function user(index: number): TestUser {
    const found = users[index];
    if (!found) throw new Error(`Test user ${index} is not initialized.`);
    return found;
  }

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("Run pnpm env:local before pnpm test:rls.");
    }

    const authOptions = {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: unusedWebSocketTransport as never },
    };
    admin = createClient(url, serviceRoleKey, authOptions);
    anonymous = createClient(url, anonKey, authOptions);

    for (let index = 0; index < 2; index++) {
      const email = `rate-limit-${randomUUID()}@example.com`;
      const password = `RateLimit-${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw error ?? new Error(`Test user ${index} was not created.`);
      }

      const client = createClient(url, anonKey, authOptions);
      users.push({ id: data.user.id, client });
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
    }
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (users.length > 0) {
      const ids = users.map(({ id }) => id);
      const { error } = await admin
        .from("rate_limits")
        .delete()
        .in("user_id", ids);
      if (error) throw error;
      for (const id of ids) {
        const { error: deleteUserError } = await admin.auth.admin.deleteUser(id);
        if (deleteUserError) throw deleteUserError;
      }
    }
  }, 30_000);

  it("limits each user independently and returns a retry delay", async () => {
    const first = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    const second = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    const third = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(third.error).toBeNull();
    expect((first.data?.[0] as { allowed: boolean }).allowed).toBe(true);
    expect((second.data?.[0] as { allowed: boolean }).allowed).toBe(true);
    const denied = third.data?.[0] as {
      allowed: boolean;
      retry_after: number;
    };
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after).toBeGreaterThanOrEqual(1);
    expect(denied.retry_after).toBeLessThanOrEqual(60);

    const otherUser = await user(1).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    expect(otherUser.error).toBeNull();
    expect((otherUser.data?.[0] as { allowed: boolean }).allowed).toBe(true);
  });

  it("rejects anonymous RPC calls", async () => {
    if (!anonymous) throw new Error("Anonymous client is not initialized.");
    const { error } = await anonymous.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  it("does not allow authenticated users to access rate_limits directly", async () => {
    const client = user(0).client;
    const read = await client.from("rate_limits").select("bucket").limit(1);
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);

    const insert = await client.from("rate_limits").insert({
      bucket: "ask:min",
      user_id: user(0).id,
      window_start: new Date().toISOString(),
      count: 1,
    });
    expect(insert.error).not.toBeNull();
  });

  it("rejects an unknown bucket", async () => {
    const { error } = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "t:min",
      p_limit: 2,
      p_window_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a window length that does not match the bucket", async () => {
    const day = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:day",
      p_limit: 2,
      p_window_seconds: 1,
    });
    const minute = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 2,
      p_window_seconds: 86_400,
    });
    expect(day.error).not.toBeNull();
    expect(minute.error).not.toBeNull();
  });

  it("rejects a zero limit", async () => {
    const { error } = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 0,
      p_window_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  it("keeps the daily counter when incrementing the minute bucket", async () => {
    if (!admin) throw new Error("Service client is not initialized.");
    const service = admin;
    const userId = user(0).id;
    const dayStart = new Date(
      Math.floor(Date.now() / 86_400_000) * 86_400_000,
    ).toISOString();
    const { error: insertError } = await service.from("rate_limits").insert({
      bucket: "ask:day",
      user_id: userId,
      window_start: dayStart,
      count: 7,
    });
    if (insertError) throw insertError;

    const readDailyCount = async () => {
      const { data, error } = await service
        .from("rate_limits")
        .select("count")
        .eq("bucket", "ask:day")
        .eq("user_id", userId)
        .eq("window_start", dayStart)
        .single();
      if (error) throw error;
      return data.count;
    };
    const before = await readDailyCount();

    const { data, error } = await user(0).client.rpc("hit_rate_limit", {
      p_bucket: "ask:min",
      p_limit: 5,
      p_window_seconds: 60,
    });
    expect(error).toBeNull();
    expect((data?.[0] as { allowed: boolean }).allowed).toBe(true);
    expect(await readDailyCount()).toBe(before);
  });
});
