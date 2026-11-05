import { describe, expect, it, vi } from "vitest";
import {
  nextStateAfterFailure,
  retryDelayMs,
  type Job,
  type JobKind,
} from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  kind: "paper.process",
  payload: { paperId: "paper-1" },
  attempts: 1,
  maxAttempts: 3,
  status: "running",
  runAfter: "2026-01-01T00:00:00.000Z",
  lockedUntil: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

function depsFor(jobs: Job[], handler = vi.fn(async () => undefined)) {
  const claimed = [...jobs];
  return {
    claimJobs: vi.fn(async () => {
      const job = claimed.shift();
      return job ? [job] : [];
    }),
    completeJob: vi.fn(async () => undefined),
    failJob: vi.fn(async () => undefined),
    handlers: { "paper.process": handler },
  };
}

describe("drainJobs", () => {
  it("completes a successful job", async () => {
    const job = makeJob();
    const deps = depsFor([job]);

    await expect(drainJobs(5, deps)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(deps.completeJob).toHaveBeenCalledWith(job.id);
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it("fails a job when its handler throws", async () => {
    const job = makeJob();
    const deps = depsFor(
      [job],
      vi.fn(async () => {
        throw new Error("temporary failure");
      }),
    );

    await expect(drainJobs(5, deps)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(deps.failJob).toHaveBeenCalledWith(job, "temporary failure");
  });

  it("stops when max jobs have been processed", async () => {
    const jobs = [makeJob(), makeJob({ id: "job-2" }), makeJob({ id: "job-3" })];
    const deps = depsFor(jobs);

    await expect(drainJobs(2, deps)).resolves.toEqual({ processed: 2, failed: 0 });
    expect(deps.claimJobs).toHaveBeenCalledTimes(2);
  });

  it("stops when there are no claimable jobs", async () => {
    const deps = depsFor([]);

    await expect(drainJobs(5, deps)).resolves.toEqual({ processed: 0, failed: 0 });
    expect(deps.claimJobs).toHaveBeenCalledTimes(1);
  });

  it("fails an unknown job kind", async () => {
    const job = makeJob({ kind: "unknown" as JobKind });
    const deps = depsFor([job]);

    await expect(drainJobs(5, deps)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(deps.failJob).toHaveBeenCalledWith(job, "unknown job kind: unknown");
  });
});

describe("retryDelayMs", () => {
  it("uses exponential delays capped at ten minutes", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(4)).toBe(240_000);
    expect(retryDelayMs(5)).toBe(480_000);
    expect(retryDelayMs(6)).toBe(600_000);
    expect(retryDelayMs(7)).toBe(600_000);
  });
});

describe("nextStateAfterFailure", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("requeues while attempts remain", () => {
    expect(nextStateAfterFailure({ attempts: 1, maxAttempts: 3 }, now)).toEqual({
      status: "queued",
      run_after: "2026-01-01T00:00:30.000Z",
      locked_until: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("marks a job failed after its last attempt", () => {
    expect(nextStateAfterFailure({ attempts: 3, maxAttempts: 3 }, now)).toEqual({
      status: "failed",
      locked_until: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });
});
