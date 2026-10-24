import { Uuid } from "@/contracts/common";
import { GetPaperResponse } from "@/contracts/papers";
import { validationFailed } from "@/server/http/errors";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
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
  return json(GetPaperResponse.parse(result));
});
