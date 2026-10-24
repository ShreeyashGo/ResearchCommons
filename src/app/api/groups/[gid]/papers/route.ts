import { ListLibraryQuery, ListLibraryResponse } from "@/contracts/papers";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { listLibrary } from "@/server/papers/service";

export const GET = routeHandler<{ gid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);
  const url = new URL(req.url);
  const query = ListLibraryQuery.parse({
    q: url.searchParams.get("q") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
  });
  const papers = await listLibrary(supabase, user.id, gid, query);
  return json(ListLibraryResponse.parse({ papers }));
});
