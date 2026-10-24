import { after } from "next/server";
import { ImportArxivRequest, ImportPaperResponse } from "@/contracts/papers";
import { startPaperProcessing } from "@/server/citations/pipeline";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { importArxivPaper } from "@/server/papers/service";

export const POST = routeHandler<{ gid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const input = await parseJson(req, ImportArxivRequest);
  const result = await importArxivPaper(supabase, user, gid, input);
  after(() => startPaperProcessing(result.paperId));
  return json(
    ImportPaperResponse.parse({
      paper: result.paper,
      deduplicated: result.deduplicated,
    }),
    201,
  );
});
