import { after } from "next/server";
import { ImportPaperResponse, UploadPaperMetadata } from "@/contracts/papers";
import { startPaperProcessing } from "@/server/citations/pipeline";
import { validationFailed } from "@/server/http/errors";
import {
  json,
  requireUser,
  routeHandler,
  uuidParam,
} from "@/server/http/handler";
import { uploadPaper } from "@/server/papers/service";

export const POST = routeHandler<{ gid: string }>(async (req, ctx) => {
  const { supabase, user } = await requireUser();
  const gid = uuidParam((await ctx.params).gid);

  const form = await req.formData().catch(() => {
    throw validationFailed("Expected multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw validationFailed('Missing required "file" field.');
  }
  const rawMetadata = form.get("metadata");
  let metadata = UploadPaperMetadata.parse({});
  if (rawMetadata !== null) {
    if (typeof rawMetadata !== "string") {
      throw validationFailed('"metadata" must be a JSON string.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMetadata);
    } catch {
      throw validationFailed('"metadata" must be valid JSON.');
    }
    metadata = UploadPaperMetadata.parse(parsed);
  }

  const result = await uploadPaper(supabase, user, gid, file, metadata);
  after(() => startPaperProcessing(result.paperId));
  return json(
    ImportPaperResponse.parse({
      paper: result.paper,
      deduplicated: result.deduplicated,
    }),
    201,
  );
});
