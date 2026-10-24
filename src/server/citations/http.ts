import "server-only";

import { internal, notFound } from "@/server/http/errors";
import type { Session } from "@/server/http/handler";

type UserClient = Session["supabase"];

/**
 * RLS-checked read: the papers row is only visible when can_read_paper() holds.
 * A missing row therefore means "not found" — we return 404 so existence isn't
 * leaked (docs/api-contracts.md).
 */
export async function requirePaperAccess(supabase: UserClient, paperId: string) {
  const { data, error } = await supabase
    .from("papers")
    .select("id,title,authors,abstract,year,arxiv_id,processing_status,processing_error")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw internal(`papers read failed: ${error.message}`);
  if (!data) throw notFound("paper not found");
  return data;
}

/**
 * Authorization for routes that take {groupId}: the caller must be a member of
 * groupId AND the paper must be linked into that group's library. One RLS-gated
 * group_papers read proves both; anything else is a 404.
 */
export async function requireGroupPaperAccess(supabase: UserClient, paperId: string, groupId: string) {
  const { data, error } = await supabase
    .from("group_papers")
    .select("paper_id")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .maybeSingle();
  if (error) throw internal(`group_papers read failed: ${error.message}`);
  if (!data) throw notFound("paper not found");
}
