import { ExplainCitationRequest, ExplainCitationResponse } from "@/contracts/ai";
import { AiOutputError, explainCitationForReference } from "@/server/ai/explain";
import { upstreamFailed } from "@/server/http/errors";
import { json, parseJson, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { requireGroupPaperAccess } from "@/server/citations/http";

/**
 * POST /api/papers/:pid/citations/:refId/explain — cached-or-generate explanation
 * of why the citing paper cites this reference. `unavailable` when the reference
 * is unresolved or has no recorded context.
 */
export const POST = routeHandler<{ pid: string; refId: string }>(async (req, ctx) => {
  const { pid, refId } = await ctx.params;
  uuidParam(pid);
  uuidParam(refId);
  const body = await parseJson(req, ExplainCitationRequest);

  const { supabase } = await requireUser();
  await requireGroupPaperAccess(supabase, pid, body.groupId); // 404 unless member + linked

  let result;
  try {
    result = await explainCitationForReference(pid, refId);
  } catch (err) {
    if (err instanceof AiOutputError) {
      throw upstreamFailed("the AI output failed validation");
    }
    throw err;
  }
  return json(ExplainCitationResponse.parse(result));
});
