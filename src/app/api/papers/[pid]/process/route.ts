import { NextResponse, after, type NextRequest } from "next/server";
import { ProcessPaperResponse } from "@/contracts/citations";
import { HttpError, requirePaperAccess, requireUser, toJsonError } from "@/server/citations/http";
import { claimPaperProcessing, startPaperProcessing } from "@/server/citations/pipeline";
import { createUserClient } from "@/server/supabase/user";

interface RouteCtx {
  params: Promise<{ pid: string }>;
}

/**
 * POST /api/papers/:pid/process — idempotent (re)run of the citation pipeline.
 * 409 while a run is in flight; the run itself continues via `after()`.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { pid } = await ctx.params;
    const supabase = await createUserClient();
    await requireUser(supabase);
    await requirePaperAccess(supabase, pid); // 404 unless can_read_paper

    // Atomically claim the run: only one processing status transition wins.
    const claimed = await claimPaperProcessing(pid);
    if (!claimed) throw new HttpError("conflict", "paper is already being processed");

    after(async () => {
      try {
        await startPaperProcessing(pid);
      } catch (err) {
        // startPaperProcessing already recorded the failure on the row.
        console.error(`[process] pipeline failed for ${pid}:`, err);
      }
    });

    return NextResponse.json(ProcessPaperResponse.parse({ processingStatus: "processing" }), {
      status: 202,
    });
  } catch (err) {
    return toJsonError(err);
  }
}
