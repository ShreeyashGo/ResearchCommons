import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const rlsTestsEnabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the jobs RLS tests.");
  }
};

describe.skipIf(!rlsTestsEnabled)("jobs RLS and claim RPC", () => {
  let admin: SupabaseClient | undefined;
  let user: SupabaseClient | undefined;
  let userId: string | undefined;
  const jobIds: string[] = [];

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
    const email = `jobs-${randomUUID()}@example.com`;
    const password = `JobsTest-${randomUUID()}-Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("No test user was created.");
    userId = data.user.id;

    user = createClient(url, anonKey, authOptions);
    const { error: signInError } = await user.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    }
  }, 30_000);

  afterEach(async () => {
    if (!admin || jobIds.length === 0) return;
    const ids = jobIds.splice(0, jobIds.length);
    const { error } = await admin.from("jobs").delete().in("id", ids);
    if (error) throw error;
  });

  async function insertJob(
    input: {
      paperId?: string;
      status?: "queued" | "running";
      attempts?: number;
      maxAttempts?: number;
      lockedUntil?: string | null;
    } = {},
  ) {
    if (!admin) throw new Error("Service client is not initialized.");
    const { data, error } = await admin
      .from("jobs")
      .insert({
        kind: "paper.process",
        payload: { paperId: input.paperId ?? randomUUID() },
        status: input.status ?? "queued",
        attempts: input.attempts ?? 0,
        max_attempts: input.maxAttempts ?? 3,
        run_after: new Date(Date.now() - 60_000).toISOString(),
        locked_until: input.lockedUntil ?? null,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (!data) throw new Error("Service client did not create a job.");
    jobIds.push(data.id);
    return data.id;
  }

  it("prevents authenticated users from reading, inserting, or claiming jobs", async () => {
    if (!user) throw new Error("Signed-in client is not initialized.");

    const read = await user.from("jobs").select("id").limit(1);
    expect(read.error).not.toBeNull();

    const insert = await user
      .from("jobs")
      .insert({ kind: "paper.process", payload: { paperId: randomUUID() } });
    expect(insert.error).not.toBeNull();

    const claim = await user.rpc("claim_jobs", {
      p_limit: 1,
      p_lease_seconds: 600,
    });
    expect(claim.error).not.toBeNull();
  });

  it("rejects a second active processing job for the same paper", async () => {
    if (!admin) throw new Error("Service client is not initialized.");
    const paperId = randomUUID();
    await insertJob({ paperId });

    const { error } = await admin.from("jobs").insert({
      kind: "paper.process",
      payload: { paperId },
    });
    expect(error?.code).toBe("23505");
  });

  it("claims two concurrent jobs with different ids and increments attempts", async () => {
    if (!admin) throw new Error("Service client is not initialized.");
    await insertJob();
    await insertJob();

    const [first, second] = await Promise.all([
      admin.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 600 }),
      admin.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 600 }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data).toHaveLength(1);
    expect(second.data).toHaveLength(1);
    const firstJob = first.data?.[0] as { id: string; attempts: number };
    const secondJob = second.data?.[0] as { id: string; attempts: number };
    expect(firstJob.id).not.toBe(secondJob.id);
    expect(firstJob.attempts).toBe(1);
    expect(secondJob.attempts).toBe(1);
  });

  it("reclaims an expired running job and increments attempts", async () => {
    if (!admin) throw new Error("Service client is not initialized.");
    const id = await insertJob({
      status: "running",
      attempts: 1,
      lockedUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const { data, error } = await admin.rpc("claim_jobs", {
      p_limit: 1,
      p_lease_seconds: 600,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data?.[0] as { id: string; attempts: number }).id).toBe(id);
    expect((data?.[0] as { id: string; attempts: number }).attempts).toBe(2);
  });

  it("fails expired jobs that have exhausted attempts without returning them", async () => {
    if (!admin) throw new Error("Service client is not initialized.");
    const id = await insertJob({
      status: "running",
      attempts: 3,
      maxAttempts: 3,
      lockedUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const { data, error } = await admin.rpc("claim_jobs", {
      p_limit: 1,
      p_lease_seconds: 600,
    });
    expect(error).toBeNull();
    expect(data?.some((job: { id: string }) => job.id === id)).toBe(false);

    const { data: job, error: lookupError } = await admin
      .from("jobs")
      .select("status")
      .eq("id", id)
      .single();
    expect(lookupError).toBeNull();
    expect(job?.status).toBe("failed");
  });
});
