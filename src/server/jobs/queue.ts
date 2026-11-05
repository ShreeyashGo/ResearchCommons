import "server-only";

import { createAdminClient } from "@/server/supabase/admin";

export type JobKind = "paper.process";

export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  status: "queued" | "running" | "done" | "failed";
  runAfter: string;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

type JobRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  status: Job["status"];
  run_after: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    status: row.status,
    runAfter: row.run_after,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown>,
  opts?: { maxAttempts?: number },
): Promise<{ enqueued: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("jobs").insert({
    kind,
    payload,
    ...(opts?.maxAttempts !== undefined
      ? { max_attempts: opts.maxAttempts }
      : {}),
  });
  if (error?.code === "23505") return { enqueued: false };
  if (error) throw error;
  return { enqueued: true };
}

export function enqueuePaperProcessing(paperId: string) {
  return enqueueJob("paper.process", { paperId });
}

export async function markPaperProcessingPending(paperId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("papers")
    .update({ processing_status: "pending", processing_error: null })
    .eq("id", paperId)
    .neq("processing_status", "processing");
  if (error) throw error;
}

export async function claimJobs(
  limit: number,
  leaseSeconds = 600,
): Promise<Job[]> {
  const { data, error } = await createAdminClient().rpc("claim_jobs", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return ((data ?? []) as JobRow[]).map(fromRow);
}

export async function completeJob(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("jobs")
    .update({
      status: "done",
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** (attempts - 1), 10 * 60 * 1000);
}

export function nextStateAfterFailure(
  job: Pick<Job, "attempts" | "maxAttempts">,
  now = new Date(),
): {
  status: "queued" | "failed";
  run_after?: string;
  locked_until: null;
  updated_at: string;
} {
  const updatedAt = now.toISOString();
  if (job.attempts < job.maxAttempts) {
    return {
      status: "queued",
      run_after: new Date(now.getTime() + retryDelayMs(job.attempts)).toISOString(),
      locked_until: null,
      updated_at: updatedAt,
    };
  }
  return { status: "failed", locked_until: null, updated_at: updatedAt };
}

export async function failJob(job: Job, message: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("jobs")
    .update({
      ...nextStateAfterFailure(job),
      last_error: message.slice(0, 800),
    })
    .eq("id", job.id);
  if (error) throw error;
}
