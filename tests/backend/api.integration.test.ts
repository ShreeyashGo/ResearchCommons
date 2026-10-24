import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnnotationResponse, ListAnnotationsResponse } from "@/contracts/annotations";
import { DashboardResponse } from "@/contracts/dashboard";
import { ListLibraryResponse } from "@/contracts/papers";
import { ListReviewsResponse, ReviewResponse } from "@/contracts/reviews";
import {
  addComment,
  createAnnotation,
  deleteAnnotation,
  deleteComment,
  listAnnotations,
  updateAnnotation,
  updateComment,
} from "@/server/annotations/service";
import { getDashboard } from "@/server/dashboard/service";
import {
  createGroup,
  getGroup,
  joinGroup,
  listGroups,
} from "@/server/groups/service";
import {
  getLibraryPaper,
  getPaperDownload,
  listLibrary,
  updatePaperTags,
  uploadPaper,
} from "@/server/papers/service";
import {
  deleteMyReview,
  listReviews,
  upsertMyReview,
} from "@/server/reviews/service";

const enabled = process.env.RLS_TESTS === "1";

type TestUser = { id: string; client: SupabaseClient; user: User };

const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by these tests.");
  }
};

function makePdf(variant = ""): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`%PDF-1.4
${variant ? `% ${variant}\n` : ""}1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`));
}

const ANCHOR = (exact: string) => ({
  version: 1 as const,
  pageIndex: 0,
  rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
  quote: { exact, prefix: "", suffix: "" },
});

describe.skipIf(!enabled)("backend API integration (local Supabase)", () => {
  let admin: SupabaseClient;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  const groupIds: string[] = [];
  const paperIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("Run pnpm env:local before running RLS_TESTS=1 tests.");
    }
    const authOptions = {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: unusedWebSocketTransport as never },
    };
    admin = createClient(url, serviceRoleKey, authOptions);
    const runId = randomUUID();
    const make = async (label: string): Promise<TestUser> => {
      const email = `api-${runId}-${label}@example.com`;
      const password = `ApiTest-${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `API ${label.toUpperCase()}` },
      });
      if (error || !data.user) {
        throw error ?? new Error("no user created");
      }
      const client = createClient(url, anonKey, authOptions);
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      return { id: data.user.id, client, user: data.user };
    };
    a = await make("a");
    b = await make("b");
    c = await make("c");
  }, 30_000);

  afterAll(async () => {
    for (const gid of groupIds) {
      await admin.from("research_groups").delete().eq("id", gid);
    }
    for (const pid of paperIds) {
      await admin.from("papers").delete().eq("id", pid);
    }
    for (const u of [a, b, c]) {
      if (u) await admin.auth.admin.deleteUser(u.id);
    }
  }, 30_000);

  it("creates and joins groups", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `API group ${randomUUID()}`,
      description: "integration test group",
    });
    groupIds.push(group.id);
    expect(group.myRole).toBe("owner");
    expect(group.memberCount).toBe(1);

    expect((await listGroups(a.client, a.id)).map((g) => g.id)).toContain(
      group.id,
    );
    expect(await listGroups(c.client, c.id)).toEqual([]);

    await expect(
      joinGroup(b.client, b.id, "deadbeef"),
    ).rejects.toMatchObject({ code: "not_found" });

    const joined = await joinGroup(b.client, b.id, group.inviteCode);
    expect(joined.id).toBe(group.id);
    // join is idempotent
    const rejoined = await joinGroup(b.client, b.id, group.inviteCode);
    expect(rejoined.id).toBe(group.id);

    const detail = await getGroup(b.client, b.id, group.id);
    expect(detail.members).toHaveLength(2);
    expect(detail.myRole).toBe("member");

    await expect(getGroup(c.client, c.id, group.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("imports PDFs with sha256 dedupe and group-level conflict", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Papers group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    await joinGroup(b.client, b.id, group.inviteCode);

    const file = new File([makePdf()], "fixture-paper.pdf", {
      type: "application/pdf",
    });
    const first = await uploadPaper(a.client, a.user, group.id, file, {
      tags: ["fixture"],
    });
    paperIds.push(first.paperId);
    expect(first.deduplicated).toBe(false);
    expect(first.paper.source).toBe("upload");
    expect(first.paper.title).toBe("fixture-paper");
    expect(first.paper.tags).toEqual(["fixture"]);

    // Same bytes into the same group -> 409.
    await expect(
      uploadPaper(a.client, a.user, group.id, file, { tags: [] }),
    ).rejects.toMatchObject({ code: "conflict" });

    // Same bytes into a different group -> deduplicated canonical paper.
    const group2 = await createGroup(b.client, b.id, {
      name: `Papers group 2 ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group2.id);
    const second = await uploadPaper(b.client, b.user, group2.id, file, {
      tags: ["copy"],
    });
    expect(second.paperId).toBe(first.paperId);
    expect(second.deduplicated).toBe(true);

    const library = ListLibraryResponse.parse({
      papers: await listLibrary(b.client, b.id, group2.id, {}),
    });
    expect(library.papers).toHaveLength(1);
    expect(library.papers[0]?.tags).toEqual(["copy"]);

    const filtered = await listLibrary(b.client, b.id, group2.id, {
      q: "fixture",
    });
    expect(filtered).toHaveLength(1);
    expect(
      await listLibrary(b.client, b.id, group2.id, { q: "no-such-title" }),
    ).toHaveLength(0);

    const retagged = await updatePaperTags(b.client, b.id, group2.id, first.paperId, {
      tags: ["retagged"],
    });
    expect(retagged.tags).toEqual(["retagged"]);

    // A member who is neither owner nor adder cannot retag.
    await expect(
      updatePaperTags(b.client, b.id, group.id, first.paperId, {
        tags: ["nope"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Non-PDF uploads are rejected before touching storage.
    const notPdf = new File([new TextEncoder().encode("hello")], "x.pdf", {
      type: "application/pdf",
    });
    await expect(
      uploadPaper(a.client, a.user, group.id, notPdf, { tags: [] }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("returns a conflict when an arXiv id belongs to a different PDF", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `arXiv conflict group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    const suffix = Number.parseInt(
      randomUUID().replaceAll("-", "").slice(0, 8),
      16,
    ) % 100_000;
    const arxivId = `2301.${String(suffix).padStart(5, "0")}`;
    const first = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "arxiv-owner.pdf", { type: "application/pdf" }),
      { tags: [] },
      { arxivId },
    );
    paperIds.push(first.paperId);

    await expect(
      uploadPaper(
        a.client,
        a.user,
        group.id,
        new File([makePdf("different bytes")], "different.pdf", {
          type: "application/pdf",
        }),
        { tags: [] },
        { arxivId },
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "This arXiv paper is already in the library.",
    });
  });

  it("serves a signed PDF URL to members only", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Signed URL group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    await joinGroup(b.client, b.id, group.inviteCode);
    const imported = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "signed.pdf", { type: "application/pdf" }),
      { tags: [] },
    );
    paperIds.push(imported.paperId);

    const res = await getPaperDownload(
      b.client,
      b.user,
      group.id,
      imported.paperId,
    );
    expect(res.pdfUrl).toMatch(/^http/);
    expect(res.pdfUrlExpiresAt).toBeTruthy();
    expect(res.paper.id).toBe(imported.paperId);

    await expect(
      getPaperDownload(c.client, c.user, group.id, imported.paperId),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("enforces annotation visibility, threading and permissions", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Annotations group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    await joinGroup(b.client, b.id, group.inviteCode);
    const imported = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "annotated.pdf", { type: "application/pdf" }),
      { tags: [] },
    );
    paperIds.push(imported.paperId);
    const pid = imported.paperId;

    const created = AnnotationResponse.parse({
      annotation: await createAnnotation(a.client, a.user, group.id, pid, {
        anchor: ANCHOR("a quoted passage"),
        comment: "first comment",
      }),
    }).annotation;
    expect(created.comments).toHaveLength(1);
    expect(created.comments[0]?.body).toBe("first comment");

    const privateAnno = await createAnnotation(
      a.client,
      a.user,
      group.id,
      pid,
      { anchor: ANCHOR("private thought"), visibility: "private" },
    );

    const bList = ListAnnotationsResponse.parse({
      annotations: await listAnnotations(b.client, b.user, group.id, pid),
    });
    expect(bList.annotations.map((x) => x.id)).toEqual([created.id]);

    const aList = await listAnnotations(a.client, a.user, group.id, pid);
    expect(aList.map((x) => x.id)).toContain(privateAnno.id);

    await expect(
      listAnnotations(c.client, c.user, group.id, pid),
    ).rejects.toMatchObject({ code: "not_found" });

    // Threading: one level only.
    const reply = await addComment(b.client, b.user, created.id, {
      body: "a reply",
      parentId: created.comments[0]!.id,
    });
    expect(reply.parentId).toBe(created.comments[0]!.id);
    await expect(
      addComment(b.client, b.user, created.id, {
        body: "too deep",
        parentId: reply.id,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });

    // Only the author may edit/delete.
    await expect(
      updateAnnotation(b.client, b.user, created.id, { color: "blue" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      deleteAnnotation(b.client, b.user, created.id),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Comment editing and soft delete (while the annotation is still visible).
    await expect(
      updateComment(a.client, a.user, reply.id, { body: "hijacked" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const edited = await updateComment(b.client, b.user, reply.id, {
      body: "edited reply",
    });
    expect(edited.body).toBe("edited reply");
    await deleteComment(b.client, b.user, reply.id);
    await expect(
      addComment(a.client, a.user, created.id, {
        body: "reply to deleted",
        parentId: reply.id,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const list = await listAnnotations(a.client, a.user, group.id, pid);
    const thread = list
      .find((x) => x.id === created.id)
      ?.comments.find((t) => t.id === created.comments[0]!.id);
    const deletedReply = thread?.replies.find((r) => r.id === reply.id);
    expect(deletedReply?.deleted).toBe(true);
    expect(deletedReply?.body).toBe("");

    const patched = await updateAnnotation(a.client, a.user, created.id, {
      color: "blue",
      visibility: "private",
    });
    expect(patched.color).toBe("blue");
    expect(patched.visibility).toBe("private");

    // Now that it's private, B can no longer see it.
    const bListAfter = await listAnnotations(b.client, b.user, group.id, pid);
    expect(bListAfter.map((x) => x.id)).toEqual([]);
  });

  it("upserts and deletes per-author reviews", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Reviews group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    await joinGroup(b.client, b.id, group.inviteCode);
    const imported = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "reviewed.pdf", { type: "application/pdf" }),
      { tags: [] },
    );
    paperIds.push(imported.paperId);
    const pid = imported.paperId;

    const review = ReviewResponse.parse({
      review: await upsertMyReview(a.client, a.user, group.id, pid, {
        tldr: "short take",
        strengths: ["clear writing"],
        weaknesses: [],
        contributions: [],
        findings: [],
        openQuestions: [],
        relevance: "",
      }),
    }).review;
    expect(review.author.id).toBe(a.id);

    const reupserted = await upsertMyReview(a.client, a.user, group.id, pid, {
      tldr: "updated take",
      contributions: ["c1"],
      strengths: [],
      weaknesses: [],
      findings: [],
      openQuestions: [],
      relevance: "relevant",
    });
    expect(reupserted.id).toBe(review.id);
    expect(reupserted.tldr).toBe("updated take");

    await upsertMyReview(b.client, b.user, group.id, pid, {
      tldr: "b's take",
      contributions: [],
      strengths: [],
      weaknesses: [],
      findings: [],
      openQuestions: [],
      relevance: "",
    });
    const listed = ListReviewsResponse.parse({
      reviews: await listReviews(b.client, b.user, group.id, pid),
    });
    expect(listed.reviews).toHaveLength(2);

    await deleteMyReview(b.client, b.user, group.id, pid);
    expect(await listReviews(b.client, b.user, group.id, pid)).toHaveLength(1);

    await expect(
      listReviews(c.client, c.user, group.id, pid),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("builds a dashboard that excludes others' private annotations", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Dashboard group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    await joinGroup(b.client, b.id, group.inviteCode);
    const imported = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "dash.pdf", { type: "application/pdf" }),
      { tags: [] },
    );
    paperIds.push(imported.paperId);
    const pid = imported.paperId;

    const pubAnno = await createAnnotation(a.client, a.user, group.id, pid, {
      anchor: ANCHOR("public quote"),
      comment: "public comment",
    });
    const privAnno = await createAnnotation(a.client, a.user, group.id, pid, {
      anchor: ANCHOR("secret quote"),
      visibility: "private",
      comment: "secret comment",
    });
    await upsertMyReview(b.client, b.user, group.id, pid, {
      tldr: "b review",
      contributions: [],
      strengths: [],
      weaknesses: [],
      findings: [],
      openQuestions: [],
      relevance: "",
    });

    const dashB = DashboardResponse.parse(
      await getDashboard(b.client, b.user, group.id),
    );
    expect(dashB.stats.papers).toBe(1);
    expect(dashB.stats.members).toBe(2);
    // B sees only the public annotation (and its comment), not A's private one.
    expect(dashB.stats.annotations).toBe(1);
    expect(dashB.stats.reviews).toBe(1);
    expect(dashB.recentPapers.map((p) => p.id)).toEqual([pid]);

    const bActivityAnnoIds = dashB.activity
      .filter((i) => i.type === "annotation_created")
      .map((i) => i.annotationId);
    expect(bActivityAnnoIds).toContain(pubAnno.id);
    expect(bActivityAnnoIds).not.toContain(privAnno.id);

    const types = new Set(dashB.activity.map((i) => i.type));
    expect(types).toContain("paper_added");
    expect(types).toContain("annotation_created");
    expect(types).toContain("comment_created");
    expect(types).toContain("review_saved");

    const dashA = DashboardResponse.parse(
      await getDashboard(a.client, a.user, group.id),
    );
    const aActivityAnnoIds = dashA.activity
      .filter((i) => i.type === "annotation_created")
      .map((i) => i.annotationId);
    expect(aActivityAnnoIds).toContain(privAnno.id);
    expect(dashA.stats.annotations).toBe(2);
    expect(dashA.recentlyAnnotated.map((p) => p.id)).toEqual([pid]);
  });

  it("returns canonical library entries with counts", async () => {
    const group = await createGroup(a.client, a.id, {
      name: `Counts group ${randomUUID()}`,
      description: "",
    });
    groupIds.push(group.id);
    const imported = await uploadPaper(
      a.client,
      a.user,
      group.id,
      new File([makePdf()], "counts.pdf", { type: "application/pdf" }),
      { tags: [] },
    );
    paperIds.push(imported.paperId);
    await createAnnotation(a.client, a.user, group.id, imported.paperId, {
      anchor: ANCHOR("counted quote"),
    });
    const { library } = await getLibraryPaper(
      a.client,
      group.id,
      imported.paperId,
    );
    expect(library.annotationCount).toBe(1);
    expect(library.reviewCount).toBe(0);
    expect(library.addedBy?.id).toBe(a.id);
  });
});
