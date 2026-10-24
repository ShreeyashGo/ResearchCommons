import { ListReviewsResponse } from "@/contracts/reviews";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { listReviews } from "@/server/reviews/service";

export const GET = routeHandler<{ gid: string; pid: string }>(
  async (_req, ctx) => {
    const { supabase, user } = await requireUser();
    const { gid, pid } = await ctx.params;
    const reviews = await listReviews(
      supabase,
      user,
      uuidParam(gid),
      uuidParam(pid),
    );
    return json(ListReviewsResponse.parse({ reviews }));
  },
);
