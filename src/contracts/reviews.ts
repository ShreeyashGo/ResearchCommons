import { z } from "zod";
import { IsoDate, ProfileSummary, Uuid } from "./common";

const Items = z.array(z.string().trim().min(1).max(2000)).max(30);

export const ReviewInput = z.object({
  tldr: z.string().trim().min(1).max(1000),
  contributions: Items.default([]),
  strengths: Items.default([]),
  weaknesses: Items.default([]),
  findings: Items.default([]),
  openQuestions: Items.default([]),
  relevance: z.string().trim().max(4000).default(""),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export const Review = ReviewInput.extend({
  id: Uuid,
  groupId: Uuid,
  paperId: Uuid,
  author: ProfileSummary,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Review = z.infer<typeof Review>;

// GET    /api/groups/:gid/papers/:pid/reviews       -> ListReviewsResponse
// PUT    /api/groups/:gid/papers/:pid/reviews/mine  body ReviewInput -> ReviewResponse (upsert)
// DELETE /api/groups/:gid/papers/:pid/reviews/mine  -> 204
export const ListReviewsResponse = z.object({ reviews: z.array(Review) });
export const ReviewResponse = z.object({ review: Review });
