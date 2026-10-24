import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Review } from "@/contracts/reviews";
import { ReviewInput } from "@/contracts/reviews";
import { fetchProfiles, requireGroupMember } from "@/server/groups/service";
import { internal } from "@/server/http/errors";
import { requirePaperInGroup } from "@/server/papers/service";
import {
  toReview,
  type ProfileRow,
  type ReviewRow,
} from "@/server/supabase/rows";

const FALLBACK_PROFILE = (id: string): ProfileRow => ({
  id,
  display_name: "Unknown",
});

async function toReviews(
  supabase: SupabaseClient,
  rows: ReviewRow[],
): Promise<Review[]> {
  const profiles = await fetchProfiles(
    supabase,
    rows.map((r) => r.author_id),
  );
  return rows.map((row) =>
    toReview(row, profiles.get(row.author_id) ?? FALLBACK_PROFILE(row.author_id)),
  );
}

export async function listReviews(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
): Promise<Review[]> {
  await requireGroupMember(supabase, groupId, user.id);
  await requirePaperInGroup(supabase, groupId, paperId);
  const { data, error } = await supabase
    .from("paper_reviews")
    .select("*")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .order("updated_at", { ascending: false });
  if (error) {
    throw internal(`Review lookup failed: ${error.message}`);
  }
  return toReviews(supabase, (data ?? []) as ReviewRow[]);
}

export async function upsertMyReview(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
  input: z.input<typeof ReviewInput>,
): Promise<Review> {
  await requireGroupMember(supabase, groupId, user.id);
  await requirePaperInGroup(supabase, groupId, paperId);
  const body = ReviewInput.parse(input);
  const { data, error } = await supabase
    .from("paper_reviews")
    .upsert(
      {
        group_id: groupId,
        paper_id: paperId,
        author_id: user.id,
        tldr: body.tldr,
        contributions: body.contributions,
        strengths: body.strengths,
        weaknesses: body.weaknesses,
        findings: body.findings,
        open_questions: body.openQuestions,
        relevance: body.relevance,
      },
      { onConflict: "group_id,paper_id,author_id" },
    )
    .select("*")
    .single();
  if (error || !data) {
    throw internal(`Could not save review: ${error?.message ?? "no row"}`);
  }
  const [review] = await toReviews(supabase, [data as ReviewRow]);
  return review!;
}

export async function deleteMyReview(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
): Promise<void> {
  await requireGroupMember(supabase, groupId, user.id);
  await requirePaperInGroup(supabase, groupId, paperId);
  const { error } = await supabase
    .from("paper_reviews")
    .delete()
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .eq("author_id", user.id);
  if (error) {
    throw internal(`Could not delete review: ${error.message}`);
  }
}
