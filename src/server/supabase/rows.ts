import type { ProfileSummary } from "@/contracts/common";
import type { Group, GroupMember, GroupRole } from "@/contracts/groups";
import type { LibraryPaper, Paper } from "@/contracts/papers";
import type { Annotation, Comment, CommentThread } from "@/contracts/annotations";
import type { Review } from "@/contracts/reviews";
import type { AnnotationAnchor } from "@/contracts/annotations";

// Row shapes mirror supabase/migrations/20261024000000_init.sql (snake_case).

export interface ProfileRow {
  id: string;
  display_name: string;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string;
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface MembershipRow {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface PaperRow {
  id: string;
  source: "arxiv" | "upload";
  title: string;
  authors: string[];
  abstract: string | null;
  year: number | null;
  doi: string | null;
  arxiv_id: string | null;
  pdf_sha256: string | null;
  storage_path: string | null;
  page_count: number | null;
  processing_status: Paper["processingStatus"];
  processing_error: string | null;
  created_by: string | null;
  created_at: string;
}

export interface GroupPaperRow {
  group_id: string;
  paper_id: string;
  added_by: string | null;
  tags: string[];
  added_at: string;
}

export interface AnnotationRow {
  id: string;
  group_id: string;
  paper_id: string;
  author_id: string;
  visibility: Annotation["visibility"];
  color: Annotation["color"];
  page_index: number;
  anchor: AnnotationAnchor;
  quote: string;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  annotation_id: string;
  parent_id: string | null;
  group_id: string;
  paper_id: string;
  author_id: string;
  body: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewRow {
  id: string;
  group_id: string;
  paper_id: string;
  author_id: string;
  tldr: string;
  contributions: string[];
  strengths: string[];
  weaknesses: string[];
  findings: string[];
  open_questions: string[];
  relevance: string;
  created_at: string;
  updated_at: string;
}

export function toProfile(row: ProfileRow): ProfileSummary {
  return { id: row.id, displayName: row.display_name };
}

export function toGroup(
  row: GroupRow,
  myRole: GroupRole,
  memberCount: number,
  paperCount: number,
): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inviteCode: row.invite_code,
    myRole,
    memberCount,
    paperCount,
    createdAt: row.created_at,
  };
}

export function toGroupMember(row: MembershipRow, profile: ProfileRow): GroupMember {
  return { ...toProfile(profile), role: row.role, joinedAt: row.joined_at };
}

export function toPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    authors: row.authors,
    abstract: row.abstract,
    year: row.year,
    doi: row.doi,
    arxivId: row.arxiv_id,
    pageCount: row.page_count,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    createdAt: row.created_at,
  };
}

export function toLibraryPaper(
  paper: PaperRow,
  link: GroupPaperRow,
  addedBy: ProfileSummary | null,
  annotationCount: number,
  reviewCount: number,
): LibraryPaper {
  return {
    ...toPaper(paper),
    groupId: link.group_id,
    tags: link.tags,
    addedBy,
    addedAt: link.added_at,
    annotationCount,
    reviewCount,
  };
}

export function toComment(row: CommentRow, author: ProfileRow): Comment {
  return {
    id: row.id,
    annotationId: row.annotation_id,
    parentId: row.parent_id,
    author: toProfile(author),
    body: row.deleted_at ? "" : row.body,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAnnotation(
  row: AnnotationRow,
  author: ProfileRow,
  comments: CommentThread[],
): Annotation {
  return {
    id: row.id,
    groupId: row.group_id,
    paperId: row.paper_id,
    author: toProfile(author),
    visibility: row.visibility,
    color: row.color,
    anchor: row.anchor,
    comments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toReview(row: ReviewRow, author: ProfileRow): Review {
  return {
    id: row.id,
    groupId: row.group_id,
    paperId: row.paper_id,
    author: toProfile(author),
    tldr: row.tldr,
    contributions: row.contributions,
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    findings: row.findings,
    openQuestions: row.open_questions,
    relevance: row.relevance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
