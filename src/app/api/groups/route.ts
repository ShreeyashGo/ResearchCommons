import {
  CreateGroupRequest,
  CreateGroupResponse,
  ListGroupsResponse,
} from "@/contracts/groups";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
} from "@/server/http/handler";
import { createGroup, listGroups } from "@/server/groups/service";

export const GET = routeHandler(async () => {
  const { supabase, user } = await requireUser();
  const groups = await listGroups(supabase, user.id);
  return json(ListGroupsResponse.parse({ groups }));
});

export const POST = routeHandler(async (req) => {
  const { supabase, user } = await requireUser();
  const input = await parseJson(req, CreateGroupRequest);
  const group = await createGroup(supabase, user.id, input);
  return json(CreateGroupResponse.parse({ group }), 201);
});
