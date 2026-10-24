import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  Annotation,
  AnnotationAnchor,
  Comment,
  CommentThread,
  CreateCommentRequest,
  UpdateAnnotationRequest,
  UpdateCommentRequest,
} from "@/contracts/annotations";
import { CreateAnnotationRequest } from "@/contracts/annotations";
import { fetchProfiles, requireGroupMember } from "@/server/groups/service";
import {
  forbidden,
  internal,
  notFound,
  validationFailed,
} from "@/server/http/errors";
import { requirePaperInGroup } from "@/server/papers/service";
import {
  toAnnotation,
  toComment,
  type AnnotationRow,
  type CommentRow,
  type ProfileRow,
} from "@/server/supabase/rows";

const FALLBACK_PROFILE = (id: string): ProfileRow => ({
  id,
  display_name: "Unknown",
});

/** Fetch an annotation the current user may read; 404 otherwise. */
async function requireReadableAnnotation(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<AnnotationRow> {
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("id", annotationId)
    .maybeSingle();
  if (error) {
    throw internal(`Annotation lookup failed: ${error.message}`);
  }
  if (!data) {
    throw notFound("Annotation not found.");
  }
  return data as AnnotationRow;
}

async function fetchCommentsFor(
  supabase: SupabaseClient,
  annotationIds: string[],
): Promise<CommentRow[]> {
  if (annotationIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .in("annotation_id", annotationIds)
    .order("created_at", { ascending: true });
  if (error) {
    throw internal(`Comment lookup failed: ${error.message}`);
  }
  return (data ?? []) as CommentRow[];
}

function buildThreads(
  comments: CommentRow[],
  profiles: Map<string, ProfileRow>,
): Map<string, CommentThread[]> {
  const threads = new Map<string, CommentThread[]>();
  const topLevel = new Map<string, CommentThread>();
  for (const row of comments) {
    const comment = toComment(
      row,
      profiles.get(row.author_id) ?? FALLBACK_PROFILE(row.author_id),
    );
    if (row.parent_id === null) {
      const thread: CommentThread = { ...comment, replies: [] };
      threads.set(row.annotation_id, [
        ...(threads.get(row.annotation_id) ?? []),
        thread,
      ]);
      topLevel.set(row.id, thread);
    } else {
      const parent = topLevel.get(row.parent_id);
      if (parent) {
        parent.replies.push(comment);
      }
      // Orphaned replies (parent deleted hard) are dropped from the tree;
      // RLS + the comments trigger make this effectively unreachable.
    }
  }
  return threads;
}

async function fetchAnnotationWithComments(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<Annotation> {
  const row = await requireReadableAnnotation(supabase, annotationId);
  const comments = await fetchCommentsFor(supabase, [annotationId]);
  const profiles = await fetchProfiles(supabase, [
    row.author_id,
    ...comments.map((c) => c.author_id),
  ]);
  const threads = buildThreads(comments, profiles);
  return toAnnotation(
    row,
    profiles.get(row.author_id) ?? FALLBACK_PROFILE(row.author_id),
    threads.get(annotationId) ?? [],
  );
}

export async function listAnnotations(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
): Promise<Annotation[]> {
  await requireGroupMember(supabase, groupId, user.id);
  await requirePaperInGroup(supabase, groupId, paperId);
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  if (error) {
    throw internal(`Annotation lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as AnnotationRow[];
  if (rows.length === 0) {
    return [];
  }
  const comments = await fetchCommentsFor(
    supabase,
    rows.map((a) => a.id),
  );
  const profiles = await fetchProfiles(supabase, [
    ...rows.map((a) => a.author_id),
    ...comments.map((c) => c.author_id),
  ]);
  const threads = buildThreads(comments, profiles);
  return rows.map((row) =>
    toAnnotation(
      row,
      profiles.get(row.author_id) ?? FALLBACK_PROFILE(row.author_id),
      threads.get(row.id) ?? [],
    ),
  );
}

export async function createAnnotation(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  paperId: string,
  input: z.input<typeof CreateAnnotationRequest>,
): Promise<Annotation> {
  await requireGroupMember(supabase, groupId, user.id);
  await requirePaperInGroup(supabase, groupId, paperId);
  const body = CreateAnnotationRequest.parse(input);
  const anchor = body.anchor as AnnotationAnchor;
  const { data, error } = await supabase
    .from("annotations")
    .insert({
      group_id: groupId,
      paper_id: paperId,
      author_id: user.id,
      visibility: body.visibility,
      color: body.color,
      page_index: anchor.pageIndex,
      anchor,
      quote: anchor.quote.exact,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw internal(`Could not create annotation: ${error?.message ?? "no row"}`);
  }
  const row = data as AnnotationRow;

  if (body.comment) {
    const { error: commentError } = await supabase.from("comments").insert({
      annotation_id: row.id,
      author_id: user.id,
      body: body.comment,
    });
    if (commentError) {
      // Keep "create with first comment" atomic: roll back the annotation.
      await supabase.from("annotations").delete().eq("id", row.id);
      throw internal(`Could not create comment: ${commentError.message}`);
    }
  }
  return fetchAnnotationWithComments(supabase, row.id);
}

export async function updateAnnotation(
  supabase: SupabaseClient,
  user: User,
  annotationId: string,
  input: z.infer<typeof UpdateAnnotationRequest>,
): Promise<Annotation> {
  const row = await requireReadableAnnotation(supabase, annotationId);
  if (row.author_id !== user.id) {
    throw forbidden("Only the author can edit this annotation.");
  }
  const { error } = await supabase
    .from("annotations")
    .update({
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    })
    .eq("id", annotationId);
  if (error) {
    throw internal(`Could not update annotation: ${error.message}`);
  }
  return fetchAnnotationWithComments(supabase, annotationId);
}

export async function deleteAnnotation(
  supabase: SupabaseClient,
  user: User,
  annotationId: string,
): Promise<void> {
  const row = await requireReadableAnnotation(supabase, annotationId);
  if (row.author_id !== user.id) {
    throw forbidden("Only the author can delete this annotation.");
  }
  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("id", annotationId);
  if (error) {
    throw internal(`Could not delete annotation: ${error.message}`);
  }
}

async function requireReadableComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<CommentRow> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("id", commentId)
    .maybeSingle();
  if (error) {
    throw internal(`Comment lookup failed: ${error.message}`);
  }
  if (!data) {
    throw notFound("Comment not found.");
  }
  return data as CommentRow;
}

async function fetchComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<Comment> {
  const row = await requireReadableComment(supabase, commentId);
  const profiles = await fetchProfiles(supabase, [row.author_id]);
  return toComment(row, profiles.get(row.author_id) ?? FALLBACK_PROFILE(row.author_id));
}

export async function addComment(
  supabase: SupabaseClient,
  user: User,
  annotationId: string,
  input: z.infer<typeof CreateCommentRequest>,
): Promise<Comment> {
  await requireReadableAnnotation(supabase, annotationId);
  if (input.parentId) {
    const { data: parent, error: parentError } = await supabase
      .from("comments")
      .select("id, annotation_id, parent_id, deleted_at")
      .eq("id", input.parentId)
      .maybeSingle();
    if (parentError) {
      throw internal(`Comment lookup failed: ${parentError.message}`);
    }
    if (!parent || parent.annotation_id !== annotationId) {
      throw notFound("Parent comment not found on this annotation.");
    }
    if (parent.deleted_at !== null) {
      throw validationFailed("Cannot reply to a deleted comment.");
    }
    if (parent.parent_id !== null) {
      throw validationFailed("Replies can only be nested one level deep.");
    }
  }
  const { data, error } = await supabase
    .from("comments")
    .insert({
      annotation_id: annotationId,
      parent_id: input.parentId ?? null,
      author_id: user.id,
      body: input.body,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw internal(`Could not create comment: ${error?.message ?? "no row"}`);
  }
  return fetchComment(supabase, (data as CommentRow).id);
}

export async function updateComment(
  supabase: SupabaseClient,
  user: User,
  commentId: string,
  input: z.infer<typeof UpdateCommentRequest>,
): Promise<Comment> {
  const row = await requireReadableComment(supabase, commentId);
  if (row.author_id !== user.id) {
    throw forbidden("Only the author can edit this comment.");
  }
  if (row.deleted_at !== null) {
    throw validationFailed("Deleted comments cannot be edited.");
  }
  const { error } = await supabase
    .from("comments")
    .update({ body: input.body })
    .eq("id", commentId);
  if (error) {
    throw internal(`Could not update comment: ${error.message}`);
  }
  return fetchComment(supabase, commentId);
}

export async function deleteComment(
  supabase: SupabaseClient,
  user: User,
  commentId: string,
): Promise<void> {
  const row = await requireReadableComment(supabase, commentId);
  if (row.author_id !== user.id) {
    throw forbidden("Only the author can delete this comment.");
  }
  // Soft delete: the before-write trigger clears the body.
  const { error } = await supabase
    .from("comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) {
    throw internal(`Could not delete comment: ${error.message}`);
  }
}
