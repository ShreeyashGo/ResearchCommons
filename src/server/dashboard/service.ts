import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ActivityItem, DashboardResponse } from "@/contracts/dashboard";
import type { LibraryPaper } from "@/contracts/papers";
import { requireGroupMember } from "@/server/groups/service";
import { internal } from "@/server/http/errors";
import {
  fetchLibraryEntries,
  toLibraryPapers,
  type LibraryEntry,
} from "@/server/papers/service";

const MAX_ACTIVITY = 30;

type DashboardActivityRow = {
  type: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  paper_id: string;
  paper_title: string | null;
  annotation_id: string | null;
  comment_id: string | null;
  review_id: string | null;
  text: string | null;
};

type GroupDashboardData = {
  stats?: {
    papers?: unknown;
    annotations?: unknown;
    comments?: unknown;
    reviews?: unknown;
    members?: unknown;
  };
  recentlyAnnotated?: string[];
  activity?: DashboardActivityRow[];
};

function toActivityItem(row: DashboardActivityRow): ActivityItem | null {
  const paperTitle = row.paper_title ?? "Untitled paper";
  switch (row.type) {
    case "paper_added":
      return {
        type: "paper_added",
        at: row.at,
        actor: row.actor_id
          ? { id: row.actor_id, displayName: row.actor_name ?? "Unknown" }
          : null,
        paperId: row.paper_id,
        paperTitle,
      };
    case "annotation_created":
      return {
        type: "annotation_created",
        at: row.at,
        actor: {
          id: row.actor_id!,
          displayName: row.actor_name ?? "Unknown",
        },
        paperId: row.paper_id,
        paperTitle,
        annotationId: row.annotation_id!,
        quote: row.text ?? "",
      };
    case "comment_created":
      return {
        type: "comment_created",
        at: row.at,
        actor: {
          id: row.actor_id!,
          displayName: row.actor_name ?? "Unknown",
        },
        paperId: row.paper_id,
        paperTitle,
        annotationId: row.annotation_id!,
        commentId: row.comment_id!,
        excerpt: row.text ?? "",
      };
    case "review_saved":
      return {
        type: "review_saved",
        at: row.at,
        actor: {
          id: row.actor_id!,
          displayName: row.actor_name ?? "Unknown",
        },
        paperId: row.paper_id,
        paperTitle,
        reviewId: row.review_id!,
        tldr: row.text ?? "",
      };
    default:
      return null;
  }
}

export async function getDashboard(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
): Promise<DashboardResponse> {
  await requireGroupMember(supabase, groupId, user.id);

  const [{ data, error }, recentEntries] = await Promise.all([
    supabase.rpc("group_dashboard", { p_group_id: groupId }),
    fetchLibraryEntries(supabase, groupId, { limit: 10 }),
  ]);
  if (error) {
    throw internal(`Dashboard query failed: ${error.message}`);
  }

  const dashboard = data as GroupDashboardData | null;
  const recentlyAnnotatedIds = dashboard?.recentlyAnnotated ?? [];
  const recentEntryIds = new Set(recentEntries.map((entry) => entry.paper.id));
  const missingEntries = await fetchLibraryEntries(supabase, groupId, {
    paperIds: recentlyAnnotatedIds.filter((id) => !recentEntryIds.has(id)),
  });
  const seenPaperIds = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const entry of [...recentEntries, ...missingEntries]) {
    if (seenPaperIds.has(entry.paper.id)) continue;
    seenPaperIds.add(entry.paper.id);
    entries.push(entry);
  }

  const libraryPapers = await toLibraryPapers(supabase, entries);
  const libraryByPaperId = new Map(libraryPapers.map((paper) => [paper.id, paper]));
  const stats = dashboard?.stats;
  const activity = (dashboard?.activity ?? [])
    .map(toActivityItem)
    .filter((item): item is ActivityItem => item !== null)
    .slice(0, MAX_ACTIVITY);

  return {
    stats: {
      papers: Number(stats?.papers ?? 0),
      annotations: Number(stats?.annotations ?? 0),
      comments: Number(stats?.comments ?? 0),
      reviews: Number(stats?.reviews ?? 0),
      members: Number(stats?.members ?? 0),
    },
    recentPapers: libraryPapers.slice(0, 10),
    recentlyAnnotated: recentlyAnnotatedIds
      .map((paperId) => libraryByPaperId.get(paperId))
      .filter((paper): paper is LibraryPaper => paper !== undefined),
    activity,
  };
}
