import {
  AnnotationResponse,
  UpdateAnnotationRequest,
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
  deleteAnnotation,
  updateAnnotation,
} from "@/server/annotations/service";

type Params = { aid: string };

export const PATCH = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const aid = uuidParam((await ctx.params).aid);
  const input = await parseJson(req, UpdateAnnotationRequest);
  const annotation = await updateAnnotation(supabase, user, aid, input);
  return json(AnnotationResponse.parse({ annotation }));
});

export const DELETE = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const aid = uuidParam((await ctx.params).aid);
  await deleteAnnotation(supabase, user, aid);
  return noContent();
});
