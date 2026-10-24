import { NextResponse, type NextRequest } from "next/server";
import { PaperSummaryRequest, PaperSummaryResponse } from "@/contracts/ai";
import { summarizePaper } from "@/server/ai/summarize";
import {
  HttpError,
  parseJsonBody,
  requireGroupPaperAccess,
  requireUser,
  toJsonError,
} from "@/server/citations/http";
import { createUserClient } from "@/server/supabase/user";

interface RouteCtx {
  params: Promise<{ pid: string }>;
}

/**
 * POST /api/papers/:pid/summary — cached-or-generate summary of the paper being
 * read. Grounded in full text when the stored PDF can be extracted, else the
 * abstract (or metadata only).
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { pid } = await ctx.params;
    const body = await parseJsonBody(req, PaperSummaryRequest);

    const supabase = await createUserClient();
    await requireUser(supabase);
    await requireGroupPaperAccess(supabase, pid, body.groupId); // 404 unless member + linked

    const result = await summarizePaper(pid);
    if (!result) throw new HttpError("not_found", "paper not found");

    return NextResponse.json(
      PaperSummaryResponse.parse({ summary: result.summary, meta: result.meta }),
    );
  } catch (err) {
    return toJsonError(err);
  }
}
