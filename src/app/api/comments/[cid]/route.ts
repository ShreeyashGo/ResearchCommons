import {
  CommentResponse,
  UpdateCommentRequest,
} from "@/contracts/annotations";
import {
  json,
  noContent,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import {
  deleteComment,
  updateComment,
} from "@/server/annotations/service";

type Params = { cid: string };

export const PATCH = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const cid = uuidParam((await ctx.params).cid);
  const input = await parseJson(req, UpdateCommentRequest);
  const comment = await updateComment(supabase, user, cid, input);
  return json(CommentResponse.parse({ comment }));
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const cid = uuidParam((await ctx.params).cid);
  await deleteComment(supabase, user, cid);
  return noContent();
});
