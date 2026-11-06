import { GetAskThreadResponse } from "@/contracts/ai";
import { clearAskThread, listAskThread } from "@/server/ai/ask-thread";
import { requireGroupPaperAccess } from "@/server/citations/http";
import {
  json,
  noContent,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";

type Params = { gid: string; pid: string };

export const GET = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid: rawGid, pid: rawPid } = await ctx.params;
  const gid = uuidParam(rawGid);
  const pid = uuidParam(rawPid);
  await requireGroupPaperAccess(supabase, pid, gid);
  const entries = await listAskThread(supabase, user.id, gid, pid);
  return json(GetAskThreadResponse.parse({ entries }));
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid: rawGid, pid: rawPid } = await ctx.params;
  const gid = uuidParam(rawGid);
  const pid = uuidParam(rawPid);
  await requireGroupPaperAccess(supabase, pid, gid);
  await clearAskThread(supabase, user.id, gid, pid);
  return noContent();
});
