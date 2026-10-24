import { z } from "zod";
import { IsoDate, ProfileSummary, Uuid } from "./common";
import { LibraryPaper } from "./papers";

export const ActivityItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paper_added"), at: IsoDate, actor: ProfileSummary.nullable(), paperId: Uuid, paperTitle: z.string() }),
  z.object({ type: z.literal("annotation_created"), at: IsoDate, actor: ProfileSummary, paperId: Uuid, paperTitle: z.string(), annotationId: Uuid, quote: z.string() }),
  z.object({ type: z.literal("comment_created"), at: IsoDate, actor: ProfileSummary, paperId: Uuid, paperTitle: z.string(), annotationId: Uuid, commentId: Uuid, excerpt: z.string() }),
  z.object({ type: z.literal("review_saved"), at: IsoDate, actor: ProfileSummary, paperId: Uuid, paperTitle: z.string(), reviewId: Uuid, tldr: z.string() }),
]);
export type ActivityItem = z.infer<typeof ActivityItem>;

// GET /api/groups/:gid/dashboard
export const DashboardResponse = z.object({
  stats: z.object({
    papers: z.number().int(),
    annotations: z.number().int(),
    comments: z.number().int(),
    reviews: z.number().int(),
    members: z.number().int(),
  }),
  recentPapers: z.array(LibraryPaper).max(10),
  /** Papers ordered by most recent annotation/comment activity. */
  recentlyAnnotated: z.array(LibraryPaper).max(10),
  /** Newest first, max 30, private annotations of others never included. */
  activity: z.array(ActivityItem).max(30),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;
