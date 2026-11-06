import { RotateInviteResponse } from "@/contracts/groups";
import { json, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import {
  requireGroupMember,
  rotateInviteCode,
} from "@/server/groups/service";

export const POST = routeHandler<{ gid: string }>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  await requireGroupMember(supabase, gid, user.id);
  const inviteCode = await rotateInviteCode(supabase, user.id, gid);
  return json(RotateInviteResponse.parse({ inviteCode }));
});
