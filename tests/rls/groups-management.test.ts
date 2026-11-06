import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestUser = { label: string; id: string; client: SupabaseClient };

const enabled = process.env.RLS_TESTS === "1";
const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the group-management RLS tests.");
  }
};

describe.skipIf(!enabled)("group-management RPC RLS", () => {
  let admin: SupabaseClient | undefined;
  const users: TestUser[] = [];
  let groupId: string | undefined;
  let originalInviteCode: string | undefined;

  function user(label: string): TestUser {
    const found = users.find((entry) => entry.label === label);
    if (!found) throw new Error(`Test user ${label} was not initialized.`);
    return found;
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

    for (const label of ["a", "b", "c", "outsider"]) {
      const email = `groups-${randomUUID()}-${label}@example.com`;
      const password = `GroupsTest-${randomUUID()}-Aa1!`;
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

    const created = await user("a").client.rpc("create_group", {
      p_name: `Group management ${randomUUID()}`,
      p_description: "Group management RLS test",
    });
    expect(created.error).toBeNull();
    if (!created.data) throw new Error("create_group returned no group.");
    const group = created.data as { id: string; invite_code: string };
    groupId = group.id;
    originalInviteCode = group.invite_code;

    for (const label of ["b", "c"]) {
      const { error } = await user(label).client.rpc("join_group", {
        p_invite_code: group.invite_code,
      });
      expect(error).toBeNull();
    }
  }, 30_000);

  afterAll(async () => {
    if (admin && groupId) {
      const { error } = await admin
        .from("research_groups")
        .delete()
        .eq("id", groupId);
      if (error) throw error;
    }
    if (admin) {
      for (const testUser of users) {
        const { error } = await admin.auth.admin.deleteUser(testUser.id);
        if (error) throw error;
      }
    }
  }, 30_000);

  it("restricts administration and protects membership changes", async () => {
    const gid = groupId;
    if (!gid) throw new Error("Test group was not initialized.");
    const owner = user("a");
    const memberB = user("b");
    const memberC = user("c");
    const outsider = user("outsider");
    if (!originalInviteCode) throw new Error("Original invite code was not initialized.");

    const cannotRotate = await memberB.client.rpc("rotate_invite_code", {
      p_group_id: gid,
    });
    expect(cannotRotate.error?.code).toBe("42501");

    const cannotRemove = await memberB.client.rpc("remove_group_member", {
      p_group_id: gid,
      p_user_id: memberC.id,
    });
    expect(cannotRemove.error?.code).toBe("42501");

    const cannotSetRole = await memberB.client.rpc("set_group_member_role", {
      p_group_id: gid,
      p_user_id: memberC.id,
      p_role: "owner",
    });
    expect(cannotSetRole.error?.code).toBe("42501");

    const { data: rotatedCode, error: rotateError } = await owner.client.rpc(
      "rotate_invite_code",
      { p_group_id: gid },
    );
    expect(rotateError).toBeNull();
    expect(typeof rotatedCode).toBe("string");

    const oldCodeJoin = await outsider.client.rpc("join_group", {
      p_invite_code: originalInviteCode,
    });
    expect(oldCodeJoin.error?.code).toBe("P0002");

    const joinedWithNewCode = await outsider.client.rpc("join_group", {
      p_invite_code: rotatedCode,
    });
    expect(joinedWithNewCode.error).toBeNull();

    const selfRemoval = await owner.client.rpc("remove_group_member", {
      p_group_id: gid,
      p_user_id: owner.id,
    });
    expect(selfRemoval.error?.code).toBe("22023");

    const ownerCannotLeave = await owner.client.rpc("leave_group", {
      p_group_id: gid,
    });
    expect(ownerCannotLeave.error?.code).toBe("23514");

    const promoteB = await owner.client.rpc("set_group_member_role", {
      p_group_id: gid,
      p_user_id: memberB.id,
      p_role: "owner",
    });
    expect(promoteB.error).toBeNull();

    const removeOutsider = await owner.client.rpc("remove_group_member", {
      p_group_id: gid,
      p_user_id: outsider.id,
    });
    expect(removeOutsider.error).toBeNull();

    const ownerLeft = await owner.client.rpc("leave_group", {
      p_group_id: gid,
    });
    expect(ownerLeft.error).toBeNull();
    expect(ownerLeft.data).toBe("left");

    const soleOwnerDemotion = await memberB.client.rpc(
      "set_group_member_role",
      {
        p_group_id: gid,
        p_user_id: memberB.id,
        p_role: "member",
      },
    );
    expect(soleOwnerDemotion.error?.code).toBe("23514");

    const directDelete = await memberC.client
      .from("group_memberships")
      .delete()
      .eq("group_id", gid)
      .eq("user_id", memberB.id)
      .select("user_id");
    expect(directDelete.error).toBeNull();
    expect(directDelete.data).toEqual([]);

    const service = admin;
    if (!service) throw new Error("Service client was not initialized.");
    const membershipStillExists = await service
      .from("group_memberships")
      .select("user_id")
      .eq("group_id", gid)
      .eq("user_id", memberB.id)
      .maybeSingle();
    expect(membershipStillExists.error).toBeNull();
    expect(membershipStillExists.data?.user_id).toBe(memberB.id);

    const removeC = await memberB.client.rpc("remove_group_member", {
      p_group_id: gid,
      p_user_id: memberC.id,
    });
    expect(removeC.error).toBeNull();

    const cCannotReadGroup = await memberC.client
      .from("research_groups")
      .select("id")
      .eq("id", gid);
    expect(cCannotReadGroup.error).toBeNull();
    expect(cCannotReadGroup.data).toEqual([]);

    const lastMemberLeaves = await memberB.client.rpc("leave_group", {
      p_group_id: gid,
    });
    expect(lastMemberLeaves.error).toBeNull();
    expect(lastMemberLeaves.data).toBe("deleted");

    const deletedGroup = await service
      .from("research_groups")
      .select("id")
      .eq("id", gid)
      .maybeSingle();
    expect(deletedGroup.error).toBeNull();
    expect(deletedGroup.data).toBeNull();

    const nonMemberLeaves = await outsider.client.rpc("leave_group", {
      p_group_id: gid,
    });
    expect(nonMemberLeaves.error?.code).toBe("P0002");
  });
});
