import { after } from "next/server";
import { ImportArxivRequest, ImportPaperResponse } from "@/contracts/papers";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { enqueuePaperProcessing } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";
import { importArxivPaper } from "@/server/papers/service";

export const POST = routeHandler<{ gid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const input = await parseJson(req, ImportArxivRequest);
  const result = await importArxivPaper(supabase, user, gid, input);
  if (
    result.paper.processingStatus === "pending" ||
    result.paper.processingStatus === "failed"
  ) {
    await enqueuePaperProcessing(result.paperId);
    after(() =>
      drainJobs(1).catch((error) => {
        console.error("[jobs] arXiv-triggered drain failed:", error);
      }),
    );
  }
  return json(
    ImportPaperResponse.parse({
      paper: result.paper,
      deduplicated: result.deduplicated,
    }),
    201,
  );
});
