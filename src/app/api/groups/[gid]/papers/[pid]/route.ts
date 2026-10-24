import { UpdateLibraryPaperRequest } from "@/contracts/papers";
import {
  json,
  noContent,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { unlinkPaper, updatePaperTags } from "@/server/papers/service";

type Params = { gid: string; pid: string };

export const PATCH = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  const input = await parseJson(req, UpdateLibraryPaperRequest);
  const paper = await updatePaperTags(
    supabase,
    user.id,
    uuidParam(gid),
    uuidParam(pid),
    input,
  );
  return json({ paper });
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  await unlinkPaper(supabase, user, uuidParam(gid), uuidParam(pid));
  return noContent();
});
