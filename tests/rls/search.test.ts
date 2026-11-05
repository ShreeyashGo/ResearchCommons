import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestUser = {
  label: string;
  id: string;
  client: SupabaseClient;
};

const rlsTestsEnabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the search RLS tests.");
  }
};

describe.skipIf(!rlsTestsEnabled)("search and dashboard RPC RLS", () => {
  let admin: SupabaseClient | undefined;
  const users: TestUser[] = [];
  const paperIds = new Map<string, string>();
  let groupId: string | undefined;
  let privateAnnotationId: string | undefined;

  function user(label: string): TestUser {
    const found = users.find((entry) => entry.label === label);
    if (!found) throw new Error(`Test user ${label} is not initialized.`);
    return found;
  }

  function requireGroupId(): string {
    if (!groupId) throw new Error("Test group is not initialized.");
    return groupId;
  }

  function paperId(key: string): string {
    const found = paperIds.get(key);
    if (!found) throw new Error(`Test paper ${key} is not initialized.`);
    return found;
  }

  async function search(
    client: SupabaseClient,
    q: string,
    tag: string | null = null,
  ) {
    const { data, error } = await client.rpc("search_group_library", {
      p_group_id: requireGroupId(),
      p_q: q,
      p_tag: tag,
    });
    expect(error).toBeNull();
    return (data ?? []) as { paper_id: string; rank: number }[];
  }

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("Run pnpm env:local before pnpm test:rls.");
    }

    const authOptions = {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: unusedWebSocketTransport as never },
    };
    admin = createClient(url, serviceRoleKey, authOptions);

    for (const label of ["a", "b", "c"]) {
      const email = `search-${randomUUID()}@example.com`;
      const password = `SearchTest-${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw error ?? new Error(`No test user ${label} was created.`);
      }

      const client = createClient(url, anonKey, authOptions);
      users.push({ label, id: data.user.id, client });
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
    }

    const { data: createdGroup, error: groupError } = await user("a").client.rpc(
      "create_group",
      {
        p_name: `Search RLS ${randomUUID()}`,
        p_description: "Search RPC RLS test",
      },
    );
    expect(groupError).toBeNull();
    if (!createdGroup) throw new Error("create_group returned no group.");
    groupId = (createdGroup as { id: string }).id;

    const { error: joinError } = await user("b").client.rpc("join_group", {
      p_invite_code: (createdGroup as { invite_code: string }).invite_code,
    });
    expect(joinError).toBeNull();

    const papers = [
      {
        key: "p1",
        title: "Attention Is All You Need",
        authors: ["Noam Shazeer"],
        abstract: null,
      },
      {
        key: "p2",
        title: "Some other title",
        authors: ["Another Author"],
        abstract: "This paper discusses attention mechanisms.",
      },
      {
        key: "p3",
        title: "An unrelated article",
        authors: ["Ashish Vaswani"],
        abstract: "A separate topic with no matching terms.",
      },
    ];
    for (const paper of papers) {
      const { data, error } = await admin
        .from("papers")
        .insert({
          source: "upload",
          title: paper.title,
          authors: paper.authors,
          abstract: paper.abstract,
          created_by: user("a").id,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw error ?? new Error(`Test paper ${paper.key} was not created.`);
      }
      paperIds.set(paper.key, data.id);
    }

    const { error: linkError } = await admin.from("group_papers").insert([
      {
        group_id: groupId,
        paper_id: paperId("p1"),
        added_by: user("a").id,
        tags: [],
      },
      {
        group_id: groupId,
        paper_id: paperId("p2"),
        added_by: user("a").id,
        tags: ["nlp"],
      },
      {
        group_id: groupId,
        paper_id: paperId("p3"),
        added_by: user("a").id,
        tags: [],
      },
    ]);
    expect(linkError).toBeNull();

    const anchor = {
      version: 1,
      pageIndex: 0,
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
      quote: { exact: "Private dashboard annotation", prefix: "", suffix: "" },
    };
    const { data: annotation, error: annotationError } = await user("a").client
      .from("annotations")
      .insert({
        group_id: groupId,
        paper_id: paperId("p1"),
        author_id: user("a").id,
        visibility: "private",
        page_index: 0,
        anchor,
        quote: "Private dashboard annotation",
      })
      .select("id")
      .single();
    if (annotationError || !annotation) {
      throw annotationError ?? new Error("Private annotation was not created.");
    }
    privateAnnotationId = annotation.id;
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (groupId) {
      const { error } = await admin
        .from("research_groups")
        .delete()
        .eq("id", groupId);
      if (error) throw error;
    }
    if (paperIds.size > 0) {
      const { error } = await admin
        .from("papers")
        .delete()
        .in("id", [...paperIds.values()]);
      if (error) throw error;
    }
    for (const testUser of users) {
      const { error } = await admin.auth.admin.deleteUser(testUser.id);
      if (error) throw error;
    }
  }, 30_000);

  it("searches titles and abstracts in rank order", async () => {
    const results = await search(user("a").client, "attention");
    expect(results.map((row) => row.paper_id)).toEqual([
      paperId("p1"),
      paperId("p2"),
    ]);
  });

  it("searches author names", async () => {
    const results = await search(user("a").client, "vaswani");
    expect(results.map((row) => row.paper_id)).toEqual([paperId("p3")]);
  });

  it("supports substring fallback for short queries", async () => {
    const results = await search(user("a").client, "att");
    expect(results.map((row) => row.paper_id)).toContain(paperId("p1"));
  });

  it("filters search results by tag", async () => {
    const results = await search(user("a").client, "attention", "nlp");
    expect(results.map((row) => row.paper_id)).toEqual([paperId("p2")]);
  });

  it("hides group search results from non-members", async () => {
    const results = await search(user("c").client, "attention");
    expect(results).toEqual([]);
  });

  it("treats percent as a literal search character", async () => {
    const results = await search(user("a").client, "%");
    expect(results).toEqual([]);
  });

  it("excludes another member's private annotation from dashboard results", async () => {
    const { data, error } = await user("b").client.rpc("group_dashboard", {
      p_group_id: requireGroupId(),
    });
    expect(error).toBeNull();
    const dashboard = data as {
      stats: { annotations: number };
      recentlyAnnotated: string[];
      activity: { type: string; annotation_id: string | null }[];
    };
    expect(Number(dashboard.stats.annotations)).toBe(0);
    expect(dashboard.recentlyAnnotated).not.toContain(paperId("p1"));
    expect(
      dashboard.activity
        .filter((item) => item.type === "annotation_created")
        .map((item) => item.annotation_id),
    ).not.toContain(privateAnnotationId);
  });

  it("counts only annotations visible to the caller", async () => {
    const { data, error } = await user("b").client.rpc("library_counts", {
      p_group_id: requireGroupId(),
      p_paper_ids: [paperId("p1")],
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      { paper_id: paperId("p1"), annotations: 0, reviews: 0 },
    ]);
  });
});
