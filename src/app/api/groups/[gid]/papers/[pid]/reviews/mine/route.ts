import { ReviewInput, ReviewResponse } from "@/contracts/reviews";
import {
  json,
  noContent,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import {
  deleteMyReview,
  upsertMyReview,
} from "@/server/reviews/service";

type Params = { gid: string; pid: string };

export const PUT = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  const input = await parseJson(req, ReviewInput);
  const review = await upsertMyReview(
    supabase,
    user,
    uuidParam(gid),
    uuidParam(pid),
    input,
  );
  return json(ReviewResponse.parse({ review }));
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  await deleteMyReview(supabase, user, uuidParam(gid), uuidParam(pid));
  return noContent();
});
