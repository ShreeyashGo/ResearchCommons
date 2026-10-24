import { ExternalWork, GetCitationsResponse, type CitationContext, type Reference } from "@/contracts/citations";
import { internal } from "@/server/http/errors";
import { json, requireUser, routeHandler, uuidParam } from "@/server/http/handler";
import { deriveSearchUrl } from "@/server/citations/match";
import { requirePaperAccess } from "@/server/citations/http";

/** GET /api/papers/:pid/citations — references + contexts + resolution status. */
export const GET = routeHandler<{ pid: string }>(async (_req, ctx) => {
  const { pid } = await ctx.params;
  uuidParam(pid);
  const { supabase } = await requireUser();
  const paper = await requirePaperAccess(supabase, pid); // 404 unless can_read_paper

  const { data: refs, error: refsErr } = await supabase
    .from("paper_references")
    .select("id,paper_id,ordinal,label,raw_text,parsed_title,parsed_authors,parsed_year,match_status,match_score,match_method,external_works(*)")
    .eq("paper_id", pid)
    .order("ordinal");
  if (refsErr) throw internal(`paper_references read failed: ${refsErr.message}`);

  const { data: ctxs, error: ctxErr } = await supabase
    .from("citation_contexts")
    .select("id,reference_id,page_index,marker_text,sentence,paragraph,rects,detection_method")
    .eq("paper_id", pid)
    .order("page_index");
  if (ctxErr) throw internal(`citation_contexts read failed: ${ctxErr.message}`);

  const references: Reference[] = (refs ?? []).map((r) => {
    const joined = (Array.isArray(r.external_works) ? r.external_works[0] : r.external_works) as
      | Record<string, unknown>
      | null
      | undefined;
    const work = joined
      ? ExternalWork.safeParse({
          id: joined.id,
          source: joined.source,
          externalId: joined.external_id,
          title: joined.title,
          authors: joined.authors,
          year: joined.year,
          venue: joined.venue,
          abstract: joined.abstract,
          doi: joined.doi,
          arxivId: joined.arxiv_id,
          url: joined.url,
          openAccessPdfUrl: joined.open_access_pdf_url,
        })
      : null;
    return {
      id: r.id,
      paperId: r.paper_id,
      ordinal: r.ordinal,
      label: r.label,
      rawText: r.raw_text,
      parsedTitle: r.parsed_title,
      parsedAuthors: r.parsed_authors ?? [],
      parsedYear: r.parsed_year,
      matchStatus: r.match_status,
      matchScore: r.match_score,
      matchMethod: r.match_method,
      work: work?.success ? work.data : null,
      searchUrl: deriveSearchUrl({ title: r.parsed_title, rawText: r.raw_text }),
    };
  });

  const contexts: CitationContext[] = (ctxs ?? []).map((c) => ({
    id: c.id,
    referenceId: c.reference_id,
    pageIndex: c.page_index,
    markerText: c.marker_text,
    sentence: c.sentence,
    paragraph: c.paragraph,
    rects: (c.rects ?? []) as CitationContext["rects"],
    detectionMethod: c.detection_method,
  }));

  return json(
    GetCitationsResponse.parse({
      processingStatus: paper.processing_status,
      processingError: paper.processing_error,
      references,
      contexts,
    }),
  );
});
