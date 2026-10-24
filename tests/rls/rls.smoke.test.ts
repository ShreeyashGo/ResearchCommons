import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestUser = {
  id: string;
  client: SupabaseClient;
};

const rlsTestsEnabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the RLS smoke tests.");
  }
};

describe.skipIf(!rlsTestsEnabled)("local Supabase RLS smoke tests", () => {
  let admin: SupabaseClient | undefined;
  let anon: SupabaseClient;
  const users: TestUser[] = [];
  let groupId: string | undefined;
  let paperId: string | undefined;

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("Run pnpm env:local before pnpm test:rls.");
    }

    const authOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        transport: unusedWebSocketTransport as never,
      },
    };

    admin = createClient(url, serviceRoleKey, authOptions);
    anon = createClient(url, anonKey, authOptions);

    const runId = randomUUID();
    for (const label of ["a", "b", "c"]) {
      const email = `rls-${runId}-${label}@example.com`;
      const password = `RlsSmoke-${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `RLS ${label.toUpperCase()}` },
      });

      if (error) {
        throw error;
      }
      if (!data.user) {
        throw new Error(`Supabase did not create test user ${label}.`);
      }

      const client = createClient(url, anonKey, authOptions);
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        throw signInError;
      }

      users.push({ id: data.user.id, client });
    }
  }, 30_000);

  afterAll(async () => {
    if (!admin) {
      return;
    }

    if (groupId) {
      const { error } = await admin
        .from("research_groups")
        .delete()
        .eq("id", groupId);
      if (error) {
        throw error;
      }
    }

    if (paperId) {
      const { error } = await admin.from("papers").delete().eq("id", paperId);
      if (error) {
        throw error;
      }
    }

    for (const user of users) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) {
        throw error;
      }
    }
  }, 30_000);

  it(
    "enforces group, paper, annotation, comment, immutable-anchor, and anon access rules",
    async () => {
      const service = admin;
      if (!service) {
        throw new Error("Supabase service client was not initialized.");
      }

      const [userA, userB, userC] = users;
      if (!userA || !userB || !userC) {
        throw new Error("Expected three signed-in test users.");
      }

      const { data: createdGroup, error: createGroupError } =
        await userA.client.rpc("create_group", {
          p_name: `RLS smoke ${randomUUID()}`,
          p_description: "Local RLS smoke-test group",
        });
      expect(createGroupError).toBeNull();
      if (!createdGroup) {
        throw new Error("create_group returned no group.");
      }

      const group = createdGroup as { id: string; invite_code: string };
      groupId = group.id;

      const aGroup = await userA.client
        .from("research_groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();
      expect(aGroup.error).toBeNull();
      expect(aGroup.data?.id).toBe(group.id);

      const beforeJoin = await userB.client
        .from("research_groups")
        .select("id")
        .eq("id", group.id);
      expect(beforeJoin.error).toBeNull();
      expect(beforeJoin.data).toEqual([]);

      const { error: joinError } = await userB.client.rpc("join_group", {
        p_invite_code: group.invite_code,
      });
      expect(joinError).toBeNull();

      const afterJoin = await userB.client
        .from("research_groups")
        .select("id")
        .eq("id", group.id)
        .maybeSingle();
      expect(afterJoin.error).toBeNull();
      expect(afterJoin.data?.id).toBe(group.id);

      const { data: paper, error: paperError } = await service
        .from("papers")
        .insert({
          source: "upload",
          title: `RLS smoke paper ${randomUUID()}`,
          authors: ["RLS smoke test"],
          created_by: userA.id,
        })
        .select("id")
        .single();
      expect(paperError).toBeNull();
      if (!paper) {
        throw new Error("Service client did not create a test paper.");
      }
      paperId = paper.id;

      const { error: linkError } = await service.from("group_papers").insert({
        group_id: group.id,
        paper_id: paper.id,
        added_by: userA.id,
      });
      expect(linkError).toBeNull();

      const anchor = {
        version: 1,
        pageIndex: 0,
        rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
        quote: { exact: "A test quote", prefix: "", suffix: "" },
      };
      const { data: groupAnnotation, error: groupAnnotationError } =
        await userA.client
          .from("annotations")
          .insert({
            group_id: group.id,
            paper_id: paper.id,
            author_id: userA.id,
            visibility: "group",
            page_index: 0,
            anchor,
            quote: "A test quote",
          })
          .select("id")
          .single();
      expect(groupAnnotationError).toBeNull();
      if (!groupAnnotation) {
        throw new Error("A did not create a group annotation.");
      }

      const { data: privateAnnotation, error: privateAnnotationError } =
        await userA.client
          .from("annotations")
          .insert({
            group_id: group.id,
            paper_id: paper.id,
            author_id: userA.id,
            visibility: "private",
            page_index: 0,
            anchor,
            quote: "A private test quote",
          })
          .select("id")
          .single();
      expect(privateAnnotationError).toBeNull();
      if (!privateAnnotation) {
        throw new Error("A did not create a private annotation.");
      }

      const bAnnotations = await userB.client
        .from("annotations")
        .select("id, visibility")
        .in("id", [groupAnnotation.id, privateAnnotation.id]);
      expect(bAnnotations.error).toBeNull();
      expect(bAnnotations.data?.map(({ id }) => id)).toEqual([
        groupAnnotation.id,
      ]);

      const cAnnotations = await userC.client
        .from("annotations")
        .select("id")
        .in("id", [groupAnnotation.id, privateAnnotation.id]);
      expect(cAnnotations.error).toBeNull();
      expect(cAnnotations.data).toEqual([]);

      const cPaper = await userC.client
        .from("papers")
        .select("id")
        .eq("id", paper.id);
      expect(cPaper.error).toBeNull();
      expect(cPaper.data).toEqual([]);

      const { error: groupCommentError } = await userB.client
        .from("comments")
        .insert({
          annotation_id: groupAnnotation.id,
          author_id: userB.id,
          body: "B can comment on A's group annotation.",
        });
      expect(groupCommentError).toBeNull();

      const { error: privateCommentError } = await userB.client
        .from("comments")
        .insert({
          annotation_id: privateAnnotation.id,
          author_id: userB.id,
          body: "B cannot comment on A's private annotation.",
        });
      expect(privateCommentError).not.toBeNull();

      const deniedUpdate = await userB.client
        .from("annotations")
        .update({ color: "blue" })
        .eq("id", groupAnnotation.id)
        .select("id");
      expect(
        deniedUpdate.error !== null || !deniedUpdate.data?.length,
      ).toBe(true);

      const unchangedColor = await userA.client
        .from("annotations")
        .select("color")
        .eq("id", groupAnnotation.id)
        .single();
      expect(unchangedColor.error).toBeNull();
      expect(unchangedColor.data?.color).toBe("yellow");

      const changedAnchor = {
        ...anchor,
        quote: { exact: "A different quote", prefix: "", suffix: "" },
      };
      const anchorUpdate = await userA.client
        .from("annotations")
        .update({ anchor: changedAnchor })
        .eq("id", groupAnnotation.id)
        .select("anchor")
        .single();
      expect(anchorUpdate.error).toBeNull();
      expect(anchorUpdate.data?.anchor).toEqual(anchor);

      const anonPaper = await anon
        .from("papers")
        .select("id")
        .eq("id", paper.id);
      expect(
        anonPaper.error !== null || !anonPaper.data?.length,
      ).toBe(true);

      const anonAnnotations = await anon
        .from("annotations")
        .select("id")
        .in("id", [groupAnnotation.id, privateAnnotation.id]);
      expect(
        anonAnnotations.error !== null || !anonAnnotations.data?.length,
      ).toBe(true);
    },
    30_000,
  );
});
