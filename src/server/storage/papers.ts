import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { internal } from "@/server/http/errors";

export const PAPERS_BUCKET = "papers";
export const SIGNED_URL_TTL_SECONDS = 600;

/** Object key inside the `papers` bucket. */
export const pdfObjectKey = (paperId: string) => `papers/${paperId}.pdf`;

export async function uploadPaperPdf(
  admin: SupabaseClient,
  paperId: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = pdfObjectKey(paperId);
  const { error } = await admin.storage
    .from(PAPERS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) {
    throw internal(`PDF upload failed: ${error.message}`);
  }
  return path;
}

export async function createSignedPdfUrl(
  admin: SupabaseClient,
  objectKey: string,
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<{ signedUrl: string; expiresAt: string }> {
  const { data, error } = await admin.storage
    .from(PAPERS_BUCKET)
    .createSignedUrl(objectKey, expiresIn);
  if (error || !data?.signedUrl) {
    throw internal(`Could not sign PDF URL: ${error?.message ?? "no URL returned"}`);
  }
  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
