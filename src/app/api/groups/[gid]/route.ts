import {
  GetGroupResponse,
  UpdateGroupRequest,
  UpdateGroupResponse,
} from "@/contracts/groups";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import {
  getGroup,
  requireGroupMember,
  updateGroup,
} from "@/server/groups/service";

export const GET = routeHandler<{ gid: string }>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const group = await getGroup(supabase, user.id, gid);
  return json(GetGroupResponse.parse({ group }));
});

export const PATCH = routeHandler<{ gid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  await requireGroupMember(supabase, gid, user.id);
  const input = await parseJson(req, UpdateGroupRequest);
  const group = await updateGroup(supabase, user.id, gid, input);
  return json(UpdateGroupResponse.parse({ group }));
});
