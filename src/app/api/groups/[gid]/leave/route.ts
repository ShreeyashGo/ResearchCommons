import { LeaveGroupResponse } from "@/contracts/groups";
import { json, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { leaveGroup } from "@/server/groups/service";

export const POST = routeHandler<{ gid: string }>(async (_req, ctx) => {
  const { supabase } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const result = await leaveGroup(supabase, gid);
  return json(LeaveGroupResponse.parse({ result }));
});
