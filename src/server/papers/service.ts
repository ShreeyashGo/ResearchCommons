import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  ImportArxivRequest,
  MAX_PDF_BYTES,
  UploadPaperMetadata,
  type LibraryPaper,
  type ListLibraryQuery,
  type UpdateLibraryPaperRequest,
} from "@/contracts/papers";
import { fetchProfiles, requireGroupMember } from "@/server/groups/service";
import {
  conflict,
  forbidden,
  internal,
  notFound,
  validationFailed,
} from "@/server/http/errors";
import {
  downloadArxivPdf,
  fetchArxivMetadata,
  isPdf,
  normalizeArxivId,
} from "@/server/papers/arxiv";
import {
  createSignedPdfUrl,
  uploadPaperPdf,
} from "@/server/storage/papers";
import { createAdminClient } from "@/server/supabase/admin";
import {
  toLibraryPaper,
  type GroupPaperRow,
  type PaperRow,
  type ProfileRow,
} from "@/server/supabase/rows";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export interface LibraryEntry {
  link: GroupPaperRow;
  paper: PaperRow;
}

export async function fetchLibraryEntries(
  supabase: SupabaseClient,
  groupId: string,
): Promise<LibraryEntry[]> {
  const { data, error } = await supabase
    .from("group_papers")
    .select(
      "group_id, paper_id, added_by, tags, added_at, papers!inner(*)",
    )
    .eq("group_id", groupId)
    .order("added_at", { ascending: false });
  if (error) {
    throw internal(`Library lookup failed: ${error.message}`);
  }
  return ((data ?? []) as unknown as (GroupPaperRow & {
    papers: PaperRow;
  })[]).map((row) => ({
    link: {
      group_id: row.group_id,
      paper_id: row.paper_id,
      added_by: row.added_by,
      tags: row.tags,
      added_at: row.added_at,
    },
    paper: row.papers,
  }));
}

/** Visible annotation count (RLS hides others' private ones) + review count. */
async function fetchLibraryCounts(
  supabase: SupabaseClient,
  groupId: string,
  paperIds: string[],
): Promise<{ annotations: Map<string, number>; reviews: Map<string, number> }> {
  const annotations = new Map<string, number>();
  const reviews = new Map<string, number>();
  if (paperIds.length === 0) {
    return { annotations, reviews };
  }
  const [{ data: aRows, error: aError }, { data: rRows, error: rError }] =
    await Promise.all([
      supabase
        .from("annotations")
        .select("paper_id")
        .eq("group_id", groupId)
        .in("paper_id", paperIds),
      supabase
        .from("paper_reviews")
        .select("paper_id")
        .eq("group_id", groupId)
        .in("paper_id", paperIds),
    ]);
  if (aError) throw internal(`Annotation count failed: ${aError.message}`);
  if (rError) throw internal(`Review count failed: ${rError.message}`);
  for (const row of (aRows ?? []) as { paper_id: string }[]) {
    annotations.set(row.paper_id, (annotations.get(row.paper_id) ?? 0) + 1);
  }
  for (const row of (rRows ?? []) as { paper_id: string }[]) {
    reviews.set(row.paper_id, (reviews.get(row.paper_id) ?? 0) + 1);
  }
  return { annotations, reviews };
}

export async function toLibraryPapers(
  supabase: SupabaseClient,
  entries: LibraryEntry[],
): Promise<LibraryPaper[]> {
  if (entries.length === 0) {
    return [];
  }
  const groupId = entries[0]!.link.group_id;
  const [{ annotations, reviews }, profiles] = await Promise.all([
    fetchLibraryCounts(
      supabase,
      groupId,
      entries.map((e) => e.paper.id),
    ),
    fetchProfiles(
      supabase,
      entries.map((e) => e.link.added_by).filter((id): id is string => !!id),
    ),
  ]);
  return entries.map(({ link, paper }) =>
    toLibraryPaper(
      paper,
      link,
      link.added_by ? (toProfileSummary(profiles.get(link.added_by)) ?? null) : null,
      annotations.get(paper.id) ?? 0,
      reviews.get(paper.id) ?? 0,
    ),
  );
}

const toProfileSummary = (row: ProfileRow | undefined) =>
  row ? { id: row.id, displayName: row.display_name } : undefined;

/** The group_papers link for (group, paper), or 404 when absent. */
export async function requirePaperInGroup(
  supabase: SupabaseClient,
  groupId: string,
  paperId: string,
): Promise<GroupPaperRow> {
  const { data, error } = await supabase
    .from("group_papers")
    .select("group_id, paper_id, added_by, tags, added_at")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .maybeSingle();
  if (error) {
    throw internal(`Library lookup failed: ${error.message}`);
  }
  if (!data) {
    throw notFound("Paper not found in this group.");
  }
  return data as GroupPaperRow;
}

export async function listLibrary(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  query: z.infer<typeof ListLibraryQuery>,
): Promise<LibraryPaper[]> {
  await requireGroupMember(supabase, groupId, userId);
  let entries = await fetchLibraryEntries(supabase, groupId);
  const q = query.q?.toLowerCase();
  if (q) {
    entries = entries.filter(
      ({ paper }) =>
        paper.title.toLowerCase().includes(q) ||
        (paper.abstract ?? "").toLowerCase().includes(q) ||
        paper.authors.some((a) => a.toLowerCase().includes(q)),
    );
  }
  if (query.tag) {
    entries = entries.filter(({ link }) => link.tags.includes(query.tag!));
  }
  return toLibraryPapers(supabase, entries);
}

export async function getLibraryPaper(
  supabase: SupabaseClient,
  groupId: string,
  paperId: string,
): Promise<{ library: LibraryPaper; paper: PaperRow }> {
  const link = await requirePaperInGroup(supabase, groupId, paperId);
  const { data, error } = await supabase
    .from("papers")
    .select("*")
    .eq("id", paperId)
    .maybeSingle();
  if (error) {
    throw internal(`Paper lookup failed: ${error.message}`);
  }
  if (!data) {
    throw notFound("Paper not found in this group.");
  }
  const [library] = await toLibraryPapers(supabase, [
    { link, paper: data as PaperRow },
  ]);
  return { library: library!, paper: data as PaperRow };
}

export async function updatePaperTags(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  paperId: string,
  input: z.infer<typeof UpdateLibraryPaperRequest>,
): Promise<LibraryPaper> {
  const { role } = await requireGroupMember(supabase, groupId, userId);
  const link = await requirePaperInGroup(supabase, groupId, paperId);
  if (role !== "owner" && link.added_by !== userId) {
    throw forbidden(
      "Only the group owner or the member who added the paper can retag it.",
    );
  }
  const { error } = await supabase
    .from("group_papers")
    .update({ tags: input.tags })
    .eq("group_id", groupId)
    .eq("paper_id", paperId);
  if (error) {
    throw internal(`Tag update failed: ${error.message}`);
  }
  const { library } = await getLibraryPaper(supabase, groupId, paperId);
  return library;
}

export async function unlinkPaper(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
): Promise<void> {
  const { role } = await requireGroupMember(supabase, groupId, user.id);
  const link = await requirePaperInGroup(supabase, groupId, paperId);
  if (role !== "owner" && link.added_by !== user.id) {
    throw forbidden("Only the group owner or the member who added the paper can remove it.");
  }
  const { error } = await supabase
    .from("group_papers")
    .delete()
    .eq("group_id", groupId)
    .eq("paper_id", paperId);
  if (error) {
    throw internal(`Could not remove paper: ${error.message}`);
  }
}

/** Link a canonical paper into a group library; 409 if already linked. */
async function linkToGroup(
  supabase: SupabaseClient,
  groupId: string,
  paperId: string,
  userId: string,
  tags: string[],
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("group_papers")
    .select("paper_id")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .maybeSingle();
  if (existingError) {
    throw internal(`Library lookup failed: ${existingError.message}`);
  }
  if (existing) {
    throw conflict("This paper is already in the group's library.");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("group_papers")
    .insert({ group_id: groupId, paper_id: paperId, added_by: userId, tags });
  if (error) {
    if (error.code === "23505") {
      throw conflict("This paper is already in the group's library.");
    }
    throw internal(`Could not add paper to library: ${error.message}`);
  }
}

export interface ImportResult {
  paper: LibraryPaper;
  paperId: string;
  deduplicated: boolean;
}

/** Upload the PDF to the `papers` bucket and record storage_path on the row. */
async function storePaperPdf(
  admin: SupabaseClient,
  paper: PaperRow,
  bytes: Uint8Array,
): Promise<PaperRow> {
  const storagePath = await uploadPaperPdf(admin, paper.id, bytes);
  const { error } = await admin
    .from("papers")
    .update({ storage_path: storagePath })
    .eq("id", paper.id);
  if (error) {
    throw internal(`Could not record PDF location: ${error.message}`);
  }
  return { ...paper, storage_path: storagePath };
}

async function ensurePaperArxivId(
  admin: SupabaseClient,
  paper: PaperRow,
  arxivId: string | null,
): Promise<PaperRow> {
  if (!arxivId || paper.arxiv_id === arxivId) {
    return paper;
  }
  if (paper.arxiv_id) {
    throw conflict("This PDF is already associated with a different arXiv paper.");
  }

  const { data, error } = await admin
    .from("papers")
    .update({ arxiv_id: arxivId })
    .eq("id", paper.id)
    .is("arxiv_id", null)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      throw conflict("This arXiv paper is already in the library.");
    }
    throw internal(`Could not associate arXiv id: ${error.message}`);
  }
  if (data) {
    return data as PaperRow;
  }

  const { data: current, error: lookupError } = await admin
    .from("papers")
    .select("*")
    .eq("id", paper.id)
    .maybeSingle();
  if (lookupError || !current) {
    throw internal(`Paper lookup failed: ${lookupError?.message ?? "no row"}`);
  }
  if (current.arxiv_id !== arxivId) {
    throw conflict("This PDF is already associated with a different arXiv paper.");
  }
  return current as PaperRow;
}

export async function importArxivPaper(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  input: z.input<typeof ImportArxivRequest>,
): Promise<ImportResult> {
  await requireGroupMember(supabase, groupId, user.id);
  const body = ImportArxivRequest.parse(input);
  const arxivId = normalizeArxivId(body.url);
  if (!arxivId) {
    throw validationFailed("Not a valid arXiv link or id.");
  }

  const admin = createAdminClient();
  let paper: PaperRow | null = null;
  let deduplicated = false;

  const { data: byArxiv, error: byArxivError } = await admin
    .from("papers")
    .select("*")
    .eq("arxiv_id", arxivId)
    .maybeSingle();
  if (byArxivError) {
    throw internal(`Paper lookup failed: ${byArxivError.message}`);
  }

  if (byArxiv) {
    paper = byArxiv as PaperRow;
    deduplicated = true;
  } else {
    const [metadata, pdfBytes] = await Promise.all([
      fetchArxivMetadata(arxivId),
      downloadArxivPdf(arxivId),
    ]);
    const sha256 = sha256Hex(pdfBytes);
    const { data: bySha, error: byShaError } = await admin
      .from("papers")
      .select("*")
      .eq("pdf_sha256", sha256)
      .maybeSingle();
    if (byShaError) {
      throw internal(`Paper lookup failed: ${byShaError.message}`);
    }

    if (bySha) {
      paper = bySha as PaperRow;
      deduplicated = true;
      if (!paper.arxiv_id) {
        // Same file was uploaded before: record its arXiv id for future dedupe.
        await admin
          .from("papers")
          .update({ arxiv_id: arxivId })
          .eq("id", paper.id)
          .is("arxiv_id", null);
        paper = { ...paper, arxiv_id: arxivId };
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("papers")
        .insert({
          source: "arxiv",
          title: metadata.title,
          authors: metadata.authors,
          abstract: metadata.abstract,
          year: metadata.year,
          doi: metadata.doi,
          arxiv_id: arxivId,
          pdf_sha256: sha256,
          created_by: user.id,
        })
        .select("*")
        .single();
      if (insertError) {
        if (insertError.code === "23505") {
          // Lost a concurrent insert race; find the winner's canonical row
          // (unique keys are separate columns, so look them up separately).
          const { data: byId, error: byIdError } = await admin
            .from("papers")
            .select("*")
            .eq("arxiv_id", arxivId)
            .maybeSingle();
          if (byIdError) {
            throw internal(`Paper lookup failed: ${byIdError.message}`);
          }
          let raced = (byId as PaperRow | null) ?? null;
          if (!raced) {
            const { data: byShaAgain, error: byShaAgainError } = await admin
              .from("papers")
              .select("*")
              .eq("pdf_sha256", sha256)
              .maybeSingle();
            if (byShaAgainError) {
              throw internal(`Paper lookup failed: ${byShaAgainError.message}`);
            }
            raced = (byShaAgain as PaperRow | null) ?? null;
          }
          if (!raced) {
            throw internal(`Could not import paper: ${insertError.message}`);
          }
          paper = raced;
          deduplicated = true;
        } else {
          throw internal(`Could not import paper: ${insertError.message}`);
        }
      } else {
        paper = inserted as PaperRow;
        try {
          paper = await storePaperPdf(admin, paper, pdfBytes);
        } catch (error) {
          // Don't leave an orphaned row whose PDF never landed in storage.
          await admin.from("papers").delete().eq("id", paper.id);
          throw error;
        }
      }
    }
    if (deduplicated && !paper.storage_path) {
      // Repair a deduped paper whose PDF is missing now that we have the bytes.
      paper = await storePaperPdf(admin, paper, pdfBytes);
    }
  }

  await linkToGroup(supabase, groupId, paper.id, user.id, body.tags);
  const { library } = await getLibraryPaper(supabase, groupId, paper.id);
  return { paper: library, paperId: paper.id, deduplicated };
}

interface PdfInfo {
  title?: string;
  pageCount?: number;
}

async function extractPdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    const pdfjs = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as typeof import("pdfjs-dist");
    // pdfjs transfers/detaches the buffer it is given — hand it a copy.
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      const meta = await doc.getMetadata();
      const info = (meta?.info ?? {}) as { Title?: unknown };
      const title =
        typeof info.Title === "string" && info.Title.trim().length > 0
          ? info.Title.trim()
          : undefined;
      return { title, pageCount: doc.numPages };
    } finally {
      await doc.destroy();
    }
  } catch {
    return {};
  }
}

export interface UploadFileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface UploadPaperOptions {
  arxivId?: string;
}

export async function uploadPaper(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  file: UploadFileLike,
  metadata: z.input<typeof UploadPaperMetadata>,
  options: UploadPaperOptions = {},
): Promise<ImportResult> {
  await requireGroupMember(supabase, groupId, user.id);
  const meta = UploadPaperMetadata.parse(metadata);
  const arxivId = options.arxivId
    ? normalizeArxivId(options.arxivId)
    : null;
  if (options.arxivId && !arxivId) {
    throw validationFailed("Not a valid arXiv id.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) {
    throw validationFailed("Uploaded file is empty.");
  }
  if (bytes.length > MAX_PDF_BYTES) {
    throw validationFailed("PDF exceeds the 20 MiB limit.");
  }
  if (!isPdf(bytes)) {
    throw validationFailed("Uploaded file is not a PDF.");
  }

  const sha256 = sha256Hex(bytes);
  const admin = createAdminClient();
  let paper: PaperRow;
  let deduplicated = false;

  const { data: existing, error: lookupError } = await admin
    .from("papers")
    .select("*")
    .eq("pdf_sha256", sha256)
    .maybeSingle();
  if (lookupError) {
    throw internal(`Paper lookup failed: ${lookupError.message}`);
  }

  if (existing) {
    paper = existing as PaperRow;
    deduplicated = true;
  } else {
    const info = await extractPdfInfo(bytes);
    const title =
      meta.title ??
      info.title ??
      (file.name.replace(/\.pdf$/i, "").trim() || "Untitled paper");
    const { data: inserted, error: insertError } = await admin
      .from("papers")
      .insert({
        source: "upload",
        title: title.slice(0, 1000),
        authors: meta.authors ?? [],
        year: meta.year ?? null,
        doi: meta.doi ?? null,
        arxiv_id: arxivId,
        pdf_sha256: sha256,
        page_count: info.pageCount ?? null,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raced, error: racedError } = await admin
          .from("papers")
          .select("*")
          .eq("pdf_sha256", sha256)
          .single();
        if (racedError || !raced) {
          throw internal(
            `Could not upload paper: ${racedError?.message ?? insertError.message}`,
          );
        }
        paper = raced as PaperRow;
        deduplicated = true;
      } else {
        throw internal(`Could not upload paper: ${insertError.message}`);
      }
    } else {
      paper = inserted as PaperRow;
      try {
        paper = await storePaperPdf(admin, paper, bytes);
      } catch (error) {
        // Don't leave an orphaned row whose PDF never landed in storage.
        await admin.from("papers").delete().eq("id", paper.id);
        throw error;
      }
    }
  }
  paper = await ensurePaperArxivId(admin, paper, arxivId);
  if (deduplicated && !paper.storage_path) {
    // Repair a deduped paper whose PDF is missing now that we have the bytes.
    paper = await storePaperPdf(admin, paper, bytes);
  }

  await linkToGroup(supabase, groupId, paper.id, user.id, meta.tags);
  const { library } = await getLibraryPaper(supabase, groupId, paper.id);
  return { paper: library, paperId: paper.id, deduplicated };
}

export async function getPaperDownload(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
): Promise<{ paper: LibraryPaper; pdfUrl: string | null; pdfUrlExpiresAt: string | null }> {
  await requireGroupMember(supabase, groupId, user.id);
  const { library, paper } = await getLibraryPaper(supabase, groupId, paperId);
  if (!paper.storage_path) {
    return { paper: library, pdfUrl: null, pdfUrlExpiresAt: null };
  }
  const admin = createAdminClient();
  const { signedUrl, expiresAt } = await createSignedPdfUrl(
    admin,
    paper.storage_path,
  );
  return { paper: library, pdfUrl: signedUrl, pdfUrlExpiresAt: expiresAt };
}
