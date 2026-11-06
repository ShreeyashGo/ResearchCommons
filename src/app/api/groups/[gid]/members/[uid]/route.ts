import {
  GetGroupResponse,
  UpdateMemberRoleRequest,
} from "@/contracts/groups";
import {
  json,
  noContent,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import {
  removeGroupMember,
  requireGroupMember,
  updateMemberRole,
} from "@/server/groups/service";

type Params = { gid: string; uid: string };

export const PATCH = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid: rawGid, uid: rawUid } = await ctx.params;
  const gid = uuidParam(rawGid);
  const uid = uuidParam(rawUid);
  await requireGroupMember(supabase, gid, user.id);
  const { role } = await parseJson(req, UpdateMemberRoleRequest);
  const group = await updateMemberRole(supabase, user.id, gid, uid, role);
  return json(GetGroupResponse.parse({ group }));
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid: rawGid, uid: rawUid } = await ctx.params;
  const gid = uuidParam(rawGid);
  const uid = uuidParam(rawUid);
  await requireGroupMember(supabase, gid, user.id);
  await removeGroupMember(supabase, user.id, gid, uid);
  return noContent();
});
