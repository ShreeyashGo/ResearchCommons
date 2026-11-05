import { after } from "next/server";
import { Uuid } from "@/contracts/common";
import { GetPaperResponse } from "@/contracts/papers";
import { validationFailed } from "@/server/http/errors";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { enqueuePaperProcessing } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";
import { getPaperDownload } from "@/server/papers/service";

export const GET = routeHandler<{ pid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const pid = uuidParam((await ctx.params).pid);
  const rawGroupId = new URL(req.url).searchParams.get("groupId");
  if (!rawGroupId) {
    throw validationFailed("groupId query parameter is required.");
  }
  const groupId = Uuid.safeParse(rawGroupId);
  if (!groupId.success) {
    throw validationFailed("groupId query parameter is not a valid UUID.");
  }
  const result = await getPaperDownload(supabase, user, groupId.data, pid);
  const response = GetPaperResponse.parse(result);
  if (response.paper.processingStatus === "pending") {
    after(async () => {
      try {
        await enqueuePaperProcessing(pid);
        await drainJobs(1);
      } catch (error) {
        console.error(`[jobs] poll-triggered enqueue/drain failed for ${pid}:`, error);
      }
    });
  } else if (response.paper.processingStatus === "processing") {
    after(() =>
      drainJobs(1).catch((error) => {
        console.error("[jobs] poll-triggered drain failed:", error);
      }),
    );
  }
  return json(response);
});
