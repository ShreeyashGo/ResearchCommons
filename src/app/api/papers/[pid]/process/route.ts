import { after } from "next/server";
import { ProcessPaperResponse } from "@/contracts/citations";
import { conflict } from "@/server/http/errors";
import { json, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { requirePaperAccess } from "@/server/citations/http";
import { claimPaperProcessing, startPaperProcessing } from "@/server/citations/pipeline";

/**
 * POST /api/papers/:pid/process — idempotent (re)run of the citation pipeline.
 * 409 while a run is in flight; the run itself continues via `after()`.
 */
export const POST = routeHandler<{ pid: string }>(async (_req, ctx) => {
  const { pid } = await ctx.params;
  uuidParam(pid);
  const { supabase } = await requireUser();
  await requirePaperAccess(supabase, pid); // 404 unless can_read_paper

  // Atomically claim the run: only one processing status transition wins.
  const claimed = await claimPaperProcessing(pid);
  if (!claimed) throw conflict("paper is already being processed");

  after(async () => {
    try {
      await startPaperProcessing(pid);
    } catch (err) {
      // startPaperProcessing already recorded the failure on the row.
      console.error(`[process] pipeline failed for ${pid}:`, err);
    }
  });

  return json(ProcessPaperResponse.parse({ processingStatus: "processing" }), 202);
});
