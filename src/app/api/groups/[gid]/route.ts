import { GetGroupResponse } from "@/contracts/groups";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { getGroup } from "@/server/groups/service";

export const GET = routeHandler<{ gid: string }>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const group = await getGroup(supabase, user.id, gid);
  return json(GetGroupResponse.parse({ group }));
});
