import "server-only";

import { extractPdf } from "@/server/citations/extract";
import type { PageText } from "@/server/citations/types";
import { createAdminClient } from "@/server/supabase/admin";

export interface StoredPage {
  pageIndex: number;
  text: string;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Whitespace-normalized page text; empty pages dropped. */
export function normalizePages(pages: Pick<PageText, "pageIndex" | "text">[]): StoredPage[] {
  return pages
    .map((p) => ({ pageIndex: p.pageIndex, text: p.text.replace(/\s+/g, " ").trim() }))
    .filter((p) => p.text.length > 0);
}

export async function savePaperPages(admin: Admin, paperId: string, pages: StoredPage[]): Promise<void> {
  const { error } = await admin
    .from("paper_texts")
    .upsert({ paper_id: paperId, pages, extracted_at: new Date().toISOString() }, { onConflict: "paper_id" });
  if (error) throw new Error(`paper_texts upsert failed: ${error.message}`);
}

/**
 * Normalized page text for a paper: the cached paper_texts row, else a one-off
 * extraction of the stored PDF (cached for next time). Null when the paper has
 * no PDF or extraction fails. Service-role: callers MUST authorize first.
 */
export async function getPaperPages(paperId: string, admin: Admin = createAdminClient()): Promise<StoredPage[] | null> {
  const { data: cached, error } = await admin
    .from("paper_texts")
    .select("pages")
    .eq("paper_id", paperId)
    .maybeSingle();
  if (error) console.warn(`[paper-text] cache read failed for ${paperId}: ${error.message}`);
  if (cached) return cached.pages as StoredPage[];

  const { data: paper, error: paperErr } = await admin
    .from("papers")
    .select("storage_path")
    .eq("id", paperId)
    .maybeSingle();
  if (paperErr || !paper?.storage_path) return null;

  try {
    const { data: blob, error: dlErr } = await admin.storage.from("papers").download(paper.storage_path);
    if (dlErr || !blob) return null;
    const extracted = await extractPdf(new Uint8Array(await blob.arrayBuffer()));
    const pages = normalizePages(extracted.pages);
    await savePaperPages(admin, paperId, pages).catch((err: unknown) =>
      console.warn(`[paper-text] cache write failed for ${paperId}:`, err),
    );
    return pages;
  } catch (err) {
    console.warn(`[paper-text] extraction failed for ${paperId}:`, err);
    return null;
  }
}
