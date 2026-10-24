import { JoinGroupRequest, JoinGroupResponse } from "@/contracts/groups";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
} from "@/server/http/handler";
import { joinGroup } from "@/server/groups/service";

export const POST = routeHandler(async (req) => {
  const { supabase, user } = await requireUser();
  const { inviteCode } = await parseJson(req, JoinGroupRequest);
  const group = await joinGroup(supabase, user.id, inviteCode);
  return json(JoinGroupResponse.parse({ group }));
});
