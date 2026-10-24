import { NextResponse, type NextRequest } from "next/server";
import { ExplainCitationRequest, ExplainCitationResponse } from "@/contracts/ai";
import { AiOutputError, explainCitationForReference } from "@/server/ai/explain";
import {
  HttpError,
  parseJsonBody,
  requireGroupPaperAccess,
  requireUser,
  toJsonError,
} from "@/server/citations/http";
import { createUserClient } from "@/server/supabase/user";

interface RouteCtx {
  params: Promise<{ pid: string; refId: string }>;
}

/**
 * POST /api/papers/:pid/citations/:refId/explain — cached-or-generate explanation
 * of why the citing paper cites this reference. `unavailable` when the reference
 * is unresolved or has no recorded context.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { pid, refId } = await ctx.params;
    const body = await parseJsonBody(req, ExplainCitationRequest);

    const supabase = await createUserClient();
    await requireUser(supabase);
    await requireGroupPaperAccess(supabase, pid, body.groupId); // 404 unless member + linked

    let result;
    try {
      result = await explainCitationForReference(pid, refId);
    } catch (err) {
      if (err instanceof AiOutputError) {
        throw new HttpError("upstream_failed", "the AI output failed validation");
      }
      throw err;
    }
    return NextResponse.json(ExplainCitationResponse.parse(result));
  } catch (err) {
    return toJsonError(err);
  }
}
