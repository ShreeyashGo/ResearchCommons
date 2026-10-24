import { PaperSummaryRequest, PaperSummaryResponse } from "@/contracts/ai";
import { notFound } from "@/server/http/errors";
import { json, parseJson, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { summarizePaper } from "@/server/ai/summarize";
import { requireGroupPaperAccess } from "@/server/citations/http";

/**
 * POST /api/papers/:pid/summary — cached-or-generate summary of the paper being
 * read. Grounded in full text when the stored PDF can be extracted, else the
 * abstract (or metadata only).
 */
export const POST = routeHandler<{ pid: string }>(async (req, ctx) => {
  const { pid } = await ctx.params;
  uuidParam(pid);
  const body = await parseJson(req, PaperSummaryRequest);

  const { supabase } = await requireUser();
  await requireGroupPaperAccess(supabase, pid, body.groupId); // 404 unless member + linked

  const result = await summarizePaper(pid);
  if (!result) throw notFound("paper not found");

  return json(PaperSummaryResponse.parse({ summary: result.summary, meta: result.meta }));
});
