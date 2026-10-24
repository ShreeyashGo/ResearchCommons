import { DashboardResponse } from "@/contracts/dashboard";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { getDashboard } from "@/server/dashboard/service";

export const GET = routeHandler<{ gid: string }>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const dashboard = await getDashboard(supabase, user, gid);
  return json(DashboardResponse.parse(dashboard));
});
