import {
  AnnotationResponse,
  CreateAnnotationRequest,
  ListAnnotationsResponse,
} from "@/contracts/annotations";
import {
  json,
  parseJson,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import {
  createAnnotation,
  listAnnotations,
} from "@/server/annotations/service";

type Params = { gid: string; pid: string };

export const GET = routeHandler<Params>(async (_req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  const annotations = await listAnnotations(
    supabase,
    user,
    uuidParam(gid),
    uuidParam(pid),
  );
  return json(ListAnnotationsResponse.parse({ annotations }));
});

export const POST = routeHandler<Params>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const { gid, pid } = await ctx.params;
  const input = await parseJson(req, CreateAnnotationRequest);
  const annotation = await createAnnotation(
    supabase,
    user,
    uuidParam(gid),
    uuidParam(pid),
    input,
  );
  return json(AnnotationResponse.parse({ annotation }), 201);
});
