import { NextResponse, type NextRequest } from "next/server";
import { ExternalWork, GetCitationsResponse, type CitationContext, type Reference } from "@/contracts/citations";
import { deriveSearchUrl } from "@/server/citations/match";
import { HttpError, requirePaperAccess, requireUser, toJsonError } from "@/server/citations/http";
import { createUserClient } from "@/server/supabase/user";

interface RouteCtx {
  params: Promise<{ pid: string }>;
}

/** GET /api/papers/:pid/citations — references + contexts + resolution status. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { pid } = await ctx.params;
    const supabase = await createUserClient();
    await requireUser(supabase);
    const paper = await requirePaperAccess(supabase, pid);

    const { data: refs, error: refsErr } = await supabase
      .from("paper_references")
      .select("id,paper_id,ordinal,label,raw_text,parsed_title,parsed_authors,parsed_year,match_status,match_score,match_method,external_works(*)")
      .eq("paper_id", pid)
      .order("ordinal");
    if (refsErr) throw new HttpError("internal", `paper_references read failed: ${refsErr.message}`);

    const { data: ctxs, error: ctxErr } = await supabase
      .from("citation_contexts")
      .select("id,reference_id,page_index,marker_text,sentence,paragraph,rects,detection_method")
      .eq("paper_id", pid)
      .order("page_index");
    if (ctxErr) throw new HttpError("internal", `citation_contexts read failed: ${ctxErr.message}`);

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

    const body = GetCitationsResponse.parse({
      processingStatus: paper.processing_status,
      processingError: paper.processing_error,
      references,
      contexts,
    });
    return NextResponse.json(body);
  } catch (err) {
    return toJsonError(err);
  }
}
