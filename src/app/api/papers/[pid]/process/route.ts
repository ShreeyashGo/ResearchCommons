import { after } from "next/server";
import { ProcessPaperResponse } from "@/contracts/citations";
import { conflict } from "@/server/http/errors";
import { json, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { requirePaperAccess } from "@/server/citations/http";
import {
  enqueuePaperProcessing,
  markPaperProcessingPending,
} from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";

/**
 * POST /api/papers/:pid/process — idempotent (re)run of the citation pipeline.
 * 409 while a run is already queued; processing continues via the jobs worker.
 */
export const POST = routeHandler<{ pid: string }>(async (_req, ctx) => {
  const { pid } = await ctx.params;
  uuidParam(pid);
  const { supabase } = await requireUser();
  await requirePaperAccess(supabase, pid); // 404 unless can_read_paper

  const { enqueued } = await enqueuePaperProcessing(pid);
  if (!enqueued) throw conflict("paper is already being processed");

  await markPaperProcessingPending(pid);

  after(() =>
    drainJobs(1).catch((error) => {
      console.error("[jobs] process-triggered drain failed:", error);
    }),
  );

  return json(ProcessPaperResponse.parse({ processingStatus: "pending" }), 202);
});
