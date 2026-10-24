import "server-only";

import { createAdminClient } from "@/server/supabase/admin";
import { parseBibliography } from "./bibliography";
import { buildContexts } from "./contexts";
import { extractPdf } from "./extract";
import type { ExtractedPaper } from "./types";
import { detectMarkers } from "./markers";
import { resolveReferences, type FetchLike } from "./resolve";
import type { AnalysisStats, BibEntry, CitationContextInsert, PaperAnalysis } from "./types";

const PAPERS_BUCKET = "papers";
/** A 'processing' claim older than this is treated as crashed and reclaimable. */
const STALE_PROCESSING_MS = 10 * 60 * 1000;

/**
 * DB-free core: PDF bytes -> references + contexts. Exposed for tests and reuse
 * (e.g. the summary route's full-text extraction). Resolution calls go through
 * `fetchImpl` so tests can run fully offline against recorded responses.
 */
export async function analyzePaper(
  pdf: Uint8Array | Buffer,
  opts: { arxivId: string | null; fetchImpl?: FetchLike },
): Promise<PaperAnalysis & { stats: AnalysisStats; extracted: ExtractedPaper }> {
  const extracted = await extractPdf(pdf);
  const entries = parseBibliography(extracted.pages);
  const markers = detectMarkers(extracted, entries);
  const references = await resolveReferences(entries, { arxivId: opts.arxivId, fetchImpl: opts.fetchImpl });
  const byOrdinal = new Map<number, BibEntry>(entries.map((e) => [e.ordinal, e]));
  const contexts = buildContexts(markers, byOrdinal, extracted.pages);

  const stats: AnalysisStats = {
    refsFound: entries.length,
    markersTotal: markers.length,
    markersLinked: contexts.length,
    resolved: references.filter((r) => r.matchStatus === "resolved").length,
    ambiguous: references.filter((r) => r.matchStatus === "ambiguous").length,
    unresolved: references.filter((r) => r.matchStatus === "unresolved").length,
  };
  return { pageCount: extracted.pageCount, references, contexts, stats, extracted };
}

/**
 * Atomically claim a processing run: transitions processing_status to
 * 'processing' only when it isn't already. Returns false when a run is in
 * flight (callers map that to 409). A row stuck in 'processing' for longer
 * than STALE_PROCESSING_MS is assumed crashed and may be re-claimed. Uses the
 * service-role client.
 */
type Admin = ReturnType<typeof createAdminClient>;

async function claimRun(admin: Admin, paperId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: claimed, error } = await admin
    .from("papers")
    .update({ processing_status: "processing", processing_error: null })
    .eq("id", paperId)
    .or(
      `processing_status.neq.processing,` +
        `and(processing_status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select("id");
  if (error) throw new Error(`status update failed: ${error.message}`);
  return (claimed?.length ?? 0) > 0;
}

export async function claimPaperProcessing(paperId: string): Promise<boolean> {
  return claimRun(createAdminClient(), paperId);
}

/**
 * Run the pipeline body for a paper whose processing run was already claimed
 * (e.g. by the POST /process route, which claims first so it can return 409).
 */
export async function runClaimedPaperProcessing(paperId: string): Promise<void> {
  await runPaperProcessing(createAdminClient(), paperId);
}

/**
 * Idempotent citation-intelligence run for one canonical paper.
 * Self-claims the run (no-op when a live run already owns the paper), then sets
 * papers.processing_status processing -> ready | failed (with
 * processing_error), rewrites paper_references + citation_contexts atomically,
 * and upserts external_works. Uses the service-role client: callers MUST have
 * already authorized the action with the user-scoped client.
 */
export async function startPaperProcessing(paperId: string): Promise<void> {
  const admin = createAdminClient();
  if (!(await claimRun(admin, paperId))) return; // a live run owns this paper
  await runPaperProcessing(admin, paperId);
}

async function runPaperProcessing(admin: Admin, paperId: string): Promise<void> {
  const { data: paper, error: paperErr } = await admin
    .from("papers")
    .select("id,arxiv_id,storage_path,title")
    .eq("id", paperId)
    .maybeSingle();
  if (paperErr) throw new Error(`papers lookup failed: ${paperErr.message}`);
  if (!paper) throw new Error(`paper ${paperId} not found`);

  const fail = async (message: string) => {
    await admin
      .from("papers")
      .update({ processing_status: "failed", processing_error: message.slice(0, 800) })
      .eq("id", paperId);
    throw new Error(message);
  };

  const storagePath: string = paper.storage_path ?? `${PAPERS_BUCKET}/${paperId}.pdf`;
  const { data: blob, error: dlErr } = await admin.storage.from(PAPERS_BUCKET).download(storagePath);
  if (dlErr || !blob) return fail(`pdf download failed: ${dlErr?.message ?? "empty object"}`);
  const pdf = new Uint8Array(await blob.arrayBuffer());

  let analysis: Awaited<ReturnType<typeof analyzePaper>>;
  try {
    analysis = await analyzePaper(pdf, { arxivId: paper.arxiv_id ?? null });
  } catch (err) {
    return fail(`analysis failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    // Upsert distinct external works; keep (source, external_id) -> id.
    const workIds = new Map<string, string>();
    const works = analysis.references
      .map((r) => r.work)
      .filter((w): w is NonNullable<typeof w> => w !== null);
    const uniqueWorks = [...new Map(works.map((w) => [`${w.source}|${w.externalId}`, w])).values()];
    if (uniqueWorks.length > 0) {
      const { data: upserted, error: upErr } = await admin
        .from("external_works")
        .upsert(
          uniqueWorks.map((w) => ({
            source: w.source,
            external_id: w.externalId,
            title: w.title,
            authors: w.authors,
            year: w.year,
            venue: w.venue,
            abstract: w.abstract,
            doi: w.doi,
            arxiv_id: w.arxivId,
            url: w.url,
            open_access_pdf_url: w.openAccessPdfUrl,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: "source,external_id" },
        )
        .select("id,source,external_id");
      if (upErr) throw new Error(upErr.message);
      for (const row of upserted ?? []) workIds.set(`${row.source}|${row.external_id}`, row.id);
    }

    // Atomic rewrite via security-definer RPC: delete + insert refs/contexts
    // in one transaction so a failure can't leave wiped or partial citations.
    const refsJson = analysis.references.map((r) => ({
      ordinal: r.ordinal,
      label: r.label,
      raw_text: r.rawText.slice(0, 4000),
      parsed_title: r.title,
      parsed_authors: r.authors,
      parsed_year: r.year,
      external_work_id: r.work ? (workIds.get(`${r.work.source}|${r.work.externalId}`) ?? null) : null,
      match_status: r.matchStatus,
      match_score: r.matchScore,
      match_method: r.matchMethod,
    }));
    const contextsJson = analysis.contexts.map((c: CitationContextInsert) => ({
      ref_ordinal: c.refOrdinal,
      page_index: c.pageIndex,
      marker_text: c.markerText.slice(0, 200),
      sentence: c.sentence,
      paragraph: c.paragraph,
      rects: c.rects,
      detection_method: c.detectionMethod,
    }));
    const { error: rpcErr } = await admin.rpc("replace_paper_citations", {
      p_paper_id: paperId,
      p_refs: refsJson,
      p_contexts: contextsJson,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { error: doneErr } = await admin
      .from("papers")
      .update({
        processing_status: "ready",
        processing_error: null,
        processed_at: new Date().toISOString(),
        page_count: analysis.pageCount,
      })
      .eq("id", paperId);
    if (doneErr) throw new Error(doneErr.message);
  } catch (err) {
    return fail(`persistence failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
