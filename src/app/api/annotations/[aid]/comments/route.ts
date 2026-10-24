import {
  CommentResponse,
  CreateCommentRequest,
} from "@/contracts/annotations";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { addComment } from "@/server/annotations/service";

export const POST = routeHandler<{ aid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const aid = uuidParam((await ctx.params).aid);
  const input = await parseJson(req, CreateCommentRequest);
  const comment = await addComment(supabase, user, aid, input);
  return json(CommentResponse.parse({ comment }), 201);
});
