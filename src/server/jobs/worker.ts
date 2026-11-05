import "server-only";

import {
  claimJobs,
  completeJob,
  failJob,
  markPaperProcessingPending,
  nextStateAfterFailure,
  type Job,
  type JobKind,
} from "@/server/jobs/queue";
import {
  claimPaperProcessing,
  runClaimedPaperProcessing,
} from "@/server/citations/pipeline";
import { enrichPaperMetadata } from "@/server/papers/enrich";

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

type WorkerDeps = {
  claimJobs: (limit: number) => Promise<Job[]>;
  completeJob: (job: Job) => Promise<boolean>;
  failJob: (job: Job, message: string) => Promise<boolean>;
  markPaperProcessingPending: (paperId: string) => Promise<void>;
  handlers: Partial<Record<JobKind, JobHandler>>;
};

const defaultDeps: WorkerDeps = {
  claimJobs,
  completeJob,
  failJob,
  markPaperProcessingPending,
  handlers: {
    "paper.process": async (payload) => {
      const paperId = payload.paperId;
      if (typeof paperId !== "string") {
        throw new Error("paper.process job has no paperId");
      }
      if (!(await claimPaperProcessing(paperId))) {
        throw new Error("paper is already being processed");
      }
      await runClaimedPaperProcessing(paperId);
      await enrichPaperMetadata(paperId).catch((error: unknown) => {
        console.warn(`[enrich] metadata enrichment failed for ${paperId}:`, error);
      });
    },
  },
};

export async function drainJobs(
  max = 5,
  deps: WorkerDeps = defaultDeps,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  while (processed + failed < max) {
    const [job] = await deps.claimJobs(1);
    if (!job) break;

    try {
      const handler = deps.handlers[job.kind];
      if (!handler) throw new Error(`unknown job kind: ${job.kind}`);
      await handler(job.payload);
      await deps.completeJob(job);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] job ${job.id} failed: ${message}`);
      const applied = await deps.failJob(job, message);
      failed += 1;
      if (
        !applied ||
        job.kind !== "paper.process" ||
        nextStateAfterFailure(job).status !== "queued"
      ) {
        continue;
      }
      const paperId = job.payload.paperId;
      if (typeof paperId !== "string") continue;
      try {
        await deps.markPaperProcessingPending(paperId);
      } catch (retryError) {
        console.error(`[jobs] retry state update failed for ${job.id}:`, retryError);
      }
    }
  }

  return { processed, failed };
}
