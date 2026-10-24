import { AnnotationAnchor, AskPaperRequest, AskPaperResponse } from "@/contracts";
import { AiOutputError } from "@/server/ai/explain";
import { askPaper } from "@/server/ai/ask";
import { requireGroupPaperAccess } from "@/server/citations/http";
import { internal, notFound, upstreamFailed } from "@/server/http/errors";
import { json, parseJson, requireUser, routeHandler, uuidParam } from "@/server/http/handler";

/**
 * POST /api/papers/:pid/ask — Q&A grounded in the paper being read (full text
 * when the stored PDF is extractable). Not cached (MVP).
 */
export const POST = routeHandler<{ pid: string }>(async (req, ctx) => {
  const { pid } = await ctx.params;
  uuidParam(pid);
  const body = await parseJson(req, AskPaperRequest);

  const { supabase } = await requireUser();
  await requireGroupPaperAccess(supabase, pid, body.groupId); // 404 unless member + linked

  let focusPassage: { pageIndex: number; quote: string } | undefined;
  if (body.annotationId) {
    // User-scoped client: an annotation the caller can't read is a 404.
    const { data: ann, error } = await supabase
      .from("annotations")
      .select("id,anchor,quote")
      .eq("id", body.annotationId)
      .eq("paper_id", pid)
      .eq("group_id", body.groupId)
      .maybeSingle();
    if (error) throw internal(`annotations read failed: ${error.message}`);
    if (!ann) throw notFound("annotation not found");
    const anchor = AnnotationAnchor.safeParse(ann.anchor);
    focusPassage = {
      pageIndex: anchor.success ? anchor.data.pageIndex : 0,
      quote: String(ann.quote),
    };
  }

  let result;
  try {
    result = await askPaper(pid, {
      question: body.question,
      history: body.history,
      focusPassage,
    });
  } catch (err) {
    if (err instanceof AiOutputError) {
      throw upstreamFailed("the AI output failed validation");
    }
    throw err;
  }
  if (!result) throw notFound("paper not found");

  return json(AskPaperResponse.parse({ answer: result.answer, meta: result.meta }));
});
