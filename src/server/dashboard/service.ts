import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ActivityItem, DashboardResponse } from "@/contracts/dashboard";
import type { LibraryPaper } from "@/contracts/papers";
import { fetchProfiles, requireGroupMember } from "@/server/groups/service";
import { internal } from "@/server/http/errors";
import { fetchLibraryEntries, toLibraryPapers } from "@/server/papers/service";
import type { ProfileRow } from "@/server/supabase/rows";

const MAX_ACTIVITY = 30;
const EXCERPT_LENGTH = 280;

async function countRows(
  supabase: SupabaseClient,
  table: string,
  groupId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId);
  if (error) {
    throw internal(`Count failed for ${table}: ${error.message}`);
  }
  return count ?? 0;
}

export async function getDashboard(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
): Promise<DashboardResponse> {
  await requireGroupMember(supabase, groupId, user.id);

  const [
    papers,
    annotations,
    comments,
    reviews,
    members,
    entries,
    { data: recentAnnotations, error: recentAnnError },
    { data: recentComments, error: recentComError },
    { data: recentLinks, error: linksError },
    { data: activityAnnotations, error: actAnnError },
    { data: activityComments, error: actComError },
    { data: activityReviews, error: actRevError },
  ] = await Promise.all([
    countRows(supabase, "group_papers", groupId),
    countRows(supabase, "annotations", groupId),
    countRows(supabase, "comments", groupId),
    countRows(supabase, "paper_reviews", groupId),
    countRows(supabase, "group_memberships", groupId),
    fetchLibraryEntries(supabase, groupId),
    supabase
      .from("annotations")
      .select("paper_id, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("comments")
      .select("paper_id, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("group_papers")
      .select("paper_id, added_by, added_at")
      .eq("group_id", groupId)
      .order("added_at", { ascending: false })
      .limit(MAX_ACTIVITY),
    supabase
      .from("annotations")
      .select("id, paper_id, author_id, quote, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(MAX_ACTIVITY),
    supabase
      .from("comments")
      .select("id, annotation_id, paper_id, author_id, body, created_at")
      .eq("group_id", groupId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ACTIVITY),
    supabase
      .from("paper_reviews")
      .select("id, paper_id, author_id, tldr, updated_at")
      .eq("group_id", groupId)
      .order("updated_at", { ascending: false })
      .limit(MAX_ACTIVITY),
  ]);

  for (const error of [
    recentAnnError,
    recentComError,
    linksError,
    actAnnError,
    actComError,
    actRevError,
  ]) {
    if (error) {
      throw internal(`Dashboard query failed: ${error.message}`);
    }
  }

  const libraryPapers = await toLibraryPapers(supabase, entries);
  const libraryByPaper = new Map(libraryPapers.map((p) => [p.id, p]));

  // Papers ordered by most recent annotation/comment activity.
  const lastActivity = new Map<string, string>();
  for (const row of [
    ...((recentAnnotations ?? []) as { paper_id: string; created_at: string }[]),
    ...((recentComments ?? []) as { paper_id: string; created_at: string }[]),
  ]) {
    const prev = lastActivity.get(row.paper_id);
    if (!prev || row.created_at > prev) {
      lastActivity.set(row.paper_id, row.created_at);
    }
  }
  const recentlyAnnotated = [...lastActivity.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, 10)
    .map(([paperId]) => libraryByPaper.get(paperId))
    .filter((p): p is LibraryPaper => p !== undefined);

  // Activity feed: merge the four event types, newest first.
  const actorIds = new Set<string>();
  const paperIds = new Set<string>();
  const linkRows = (recentLinks ?? []) as {
    paper_id: string;
    added_by: string | null;
    added_at: string;
  }[];
  const annRows = (activityAnnotations ?? []) as {
    id: string;
    paper_id: string;
    author_id: string;
    quote: string;
    created_at: string;
  }[];
  const comRows = (activityComments ?? []) as {
    id: string;
    annotation_id: string;
    paper_id: string;
    author_id: string;
    body: string;
    created_at: string;
  }[];
  const revRows = (activityReviews ?? []) as {
    id: string;
    paper_id: string;
    author_id: string;
    tldr: string;
    updated_at: string;
  }[];

  for (const row of linkRows) {
    if (row.added_by) actorIds.add(row.added_by);
    paperIds.add(row.paper_id);
  }
  for (const row of annRows) {
    actorIds.add(row.author_id);
    paperIds.add(row.paper_id);
  }
  for (const row of comRows) {
    actorIds.add(row.author_id);
    paperIds.add(row.paper_id);
  }
  for (const row of revRows) {
    actorIds.add(row.author_id);
    paperIds.add(row.paper_id);
  }

  const [profiles, paperRows] = await Promise.all([
    fetchProfiles(supabase, [...actorIds]),
    paperIds.size > 0
      ? supabase
          .from("papers")
          .select("id, title")
          .in("id", [...paperIds])
      : { data: [], error: null },
  ]);
  if (paperRows.error) {
    throw internal(`Dashboard query failed: ${paperRows.error.message}`);
  }
  const titles = new Map(
    ((paperRows.data ?? []) as { id: string; title: string }[]).map((p) => [
      p.id,
      p.title,
    ]),
  );
  const profile = (id: string): ProfileRow =>
    profiles.get(id) ?? { id, display_name: "Unknown" };

  const activity: ActivityItem[] = [
    ...linkRows.map((row) => ({
      type: "paper_added" as const,
      at: row.added_at,
      actor: row.added_by
        ? { id: row.added_by, displayName: profile(row.added_by).display_name }
        : null,
      paperId: row.paper_id,
      paperTitle: titles.get(row.paper_id) ?? "Untitled paper",
    })),
    ...annRows.map((row) => ({
      type: "annotation_created" as const,
      at: row.created_at,
      actor: {
        id: row.author_id,
        displayName: profile(row.author_id).display_name,
      },
      paperId: row.paper_id,
      paperTitle: titles.get(row.paper_id) ?? "Untitled paper",
      annotationId: row.id,
      quote: row.quote,
    })),
    ...comRows.map((row) => ({
      type: "comment_created" as const,
      at: row.created_at,
      actor: {
        id: row.author_id,
        displayName: profile(row.author_id).display_name,
      },
      paperId: row.paper_id,
      paperTitle: titles.get(row.paper_id) ?? "Untitled paper",
      annotationId: row.annotation_id,
      commentId: row.id,
      excerpt: row.body.slice(0, EXCERPT_LENGTH),
    })),
    ...revRows.map((row) => ({
      type: "review_saved" as const,
      at: row.updated_at,
      actor: {
        id: row.author_id,
        displayName: profile(row.author_id).display_name,
      },
      paperId: row.paper_id,
      paperTitle: titles.get(row.paper_id) ?? "Untitled paper",
      reviewId: row.id,
      tldr: row.tldr,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, MAX_ACTIVITY);

  return {
    stats: { papers, annotations, comments, reviews, members },
    recentPapers: libraryPapers.slice(0, 10),
    recentlyAnnotated,
    activity,
  };
}
