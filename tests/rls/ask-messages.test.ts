import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestUser = { id: string; client: SupabaseClient };

const enabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by Ask thread RLS tests.");
  }
};

describe.skipIf(!enabled)("Ask messages RLS", () => {
  let admin: SupabaseClient | undefined;
  let anon: SupabaseClient;
  const users: TestUser[] = [];
  const paperIds: string[] = [];
  let groupId: string | undefined;

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
    anon = createClient(url, anonKey, authOptions);

    const runId = randomUUID();
    for (const label of ["a", "b", "c"]) {
      const email = `ask-rls-${runId}-${label}@example.com`;
      const password = `AskRls-${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("No test user created.");
      const client = createClient(url, anonKey, authOptions);
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      users.push({ id: data.user.id, client });
    }
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (groupId) {
      const { error } = await admin.from("research_groups").delete().eq("id", groupId);
      if (error) throw error;
    }
    for (const paperId of paperIds) {
      const { error } = await admin.from("papers").delete().eq("id", paperId);
      if (error) throw error;
    }
    for (const user of users) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
    }
  }, 30_000);

  it("scopes inserts, reads, deletes, updates, and cascades to the author", async () => {
    const service = admin;
    if (!service) throw new Error("Supabase service client was not initialized.");
    const [author, coMember, outsider] = users;
    if (!author || !coMember || !outsider) throw new Error("Expected three test users.");

    const { data: groupData, error: groupError } = await author.client.rpc("create_group", {
      p_name: `Ask RLS ${randomUUID()}`,
      p_description: "Ask thread RLS fixture",
    });
    expect(groupError).toBeNull();
    if (!groupData) throw new Error("create_group returned no group.");
    const group = groupData as { id: string; invite_code: string };
    groupId = group.id;
    const { error: joinError } = await coMember.client.rpc("join_group", {
      p_invite_code: group.invite_code,
    });
    expect(joinError).toBeNull();

    const createPaper = async (title: string) => {
      const { data, error } = await service
        .from("papers")
        .insert({
          source: "upload",
          title,
          authors: ["Ask RLS test"],
          created_by: author.id,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      if (!data) throw new Error("Service client did not create a test paper.");
      paperIds.push(data.id);
      return data.id;
    };
    const paperId = await createPaper(`Ask RLS linked ${randomUUID()}`);
    const unlinkedPaperId = await createPaper(`Ask RLS unlinked ${randomUUID()}`);
    const { error: linkError } = await service.from("group_papers").insert({
      group_id: group.id,
      paper_id: paperId,
      added_by: author.id,
    });
    expect(linkError).toBeNull();

    const answer = {
      answer: "A valid test answer.",
      evidence: [],
      grounding: "metadata_only",
      notFoundInPaper: false,
    };
    const meta = {
      provider: "mock",
      model: "mock-v1",
      isMock: true,
      promptVersion: "ask-v1",
      cached: false,
      generatedAt: new Date().toISOString(),
    };
    const payload = (userId: string, targetPaperId = paperId, question = "Test question?") => ({
      user_id: userId,
      group_id: group.id,
      paper_id: targetPaperId,
      question,
      answer,
      meta,
    });

    const { data: inserted, error: insertError } = await author.client
      .from("ask_messages")
      .insert(payload(author.id))
      .select("id")
      .single();
    expect(insertError).toBeNull();
    if (!inserted) throw new Error("Author did not create an Ask message.");

    const { data: authorRows, error: authorReadError } = await author.client
      .from("ask_messages")
      .select("id")
      .eq("id", inserted.id);
    expect(authorReadError).toBeNull();
    expect(authorRows).toHaveLength(1);

    const { data: coMemberRows, error: coMemberReadError } = await coMember.client
      .from("ask_messages")
      .select("id")
      .eq("id", inserted.id);
    expect(coMemberReadError).toBeNull();
    expect(coMemberRows).toEqual([]);

    const { data: deletedRows, error: deleteError } = await coMember.client
      .from("ask_messages")
      .delete()
      .eq("id", inserted.id)
      .select("id");
    expect(deleteError).toBeNull();
    expect(deletedRows).toEqual([]);
    const { data: preservedRow, error: preservedError } = await service
      .from("ask_messages")
      .select("id")
      .eq("id", inserted.id)
      .single();
    expect(preservedError).toBeNull();
    expect(preservedRow?.id).toBe(inserted.id);

    const { error: outsiderInsertError } = await outsider.client
      .from("ask_messages")
      .insert(payload(outsider.id));
    expect(outsiderInsertError?.code).toBe("42501");

    const { error: otherUserInsertError } = await author.client
      .from("ask_messages")
      .insert(payload(coMember.id));
    expect(otherUserInsertError?.code).toBe("42501");

    const { error: unlinkedInsertError } = await author.client
      .from("ask_messages")
      .insert(payload(author.id, unlinkedPaperId));
    expect(unlinkedInsertError?.code).toBe("23503");

    const { error: updateError } = await author.client
      .from("ask_messages")
      .update({ question: "Updated test question?" })
      .eq("id", inserted.id);
    expect(updateError?.code).toBe("42501");

    const { error: anonReadError } = await anon
      .from("ask_messages")
      .select("id")
      .eq("id", inserted.id);
    expect(anonReadError?.code).toBe("42501");

    const { error: unlinkError } = await service
      .from("group_papers")
      .delete()
      .eq("group_id", group.id)
      .eq("paper_id", paperId);
    expect(unlinkError).toBeNull();
    const { data: cascadedRows, error: cascadeReadError } = await service
      .from("ask_messages")
      .select("id")
      .eq("id", inserted.id);
    expect(cascadeReadError).toBeNull();
    expect(cascadedRows).toEqual([]);
  });
});
