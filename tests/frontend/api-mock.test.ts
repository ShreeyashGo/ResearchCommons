import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The mock API is an explicit dev-only opt-in: anything but the literal
 * string "1" must take the real HTTP path.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API_MOCK flag", () => {
  it("is false when NEXT_PUBLIC_API_MOCK is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(false);
  });

  it("is false for non-'1' values", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "true");
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(false);
  });

  it("is true only for the literal '1'", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    vi.resetModules();
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(true);
  });

  it("updates the mock profile and rejects an empty display name", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const { api } = await import("@/lib/client/api");
    await api.updateMe({ displayName: "  Grace Hopper  " });
    expect((await api.me()).profile.displayName).toBe("Grace Hopper");
    await expect(api.updateMe({ displayName: "" })).rejects.toThrow();
  });

  it("rotates invite codes and denies owner actions to members", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const { api } = await import("@/lib/client/api");
    const { groups } = await api.listGroups();
    const ownerGroup = groups.find((group) => group.myRole === "owner");
    const memberGroup = groups.find((group) => group.myRole === "member");
    if (!ownerGroup || !memberGroup) throw new Error("Expected owner and member mock groups.");

    const oldCode = ownerGroup.inviteCode;
    const rotated = await api.rotateInviteCode(ownerGroup.id);
    expect(rotated.inviteCode).not.toBe(oldCode);
    expect((await api.me()).groups.find((group) => group.id === ownerGroup.id)?.inviteCode).toBe(
      rotated.inviteCode,
    );
    await expect(api.rotateInviteCode(memberGroup.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects the last owner's leave and deletes a group when its last member leaves", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const { api } = await import("@/lib/client/api");
    const { groups } = await api.listGroups();
    const ownedGroup = groups.find((group) => group.myRole === "owner");
    if (!ownedGroup) throw new Error("Expected an owned mock group.");
    await expect(api.leaveGroup(ownedGroup.id)).rejects.toMatchObject({
      code: "conflict",
    });

    const { group } = await api.createGroup({ name: "Solo group", description: "" });
    await expect(api.leaveGroup(group.id)).resolves.toEqual({ result: "deleted" });
    expect((await api.me()).groups.some((entry) => entry.id === group.id)).toBe(false);
    await expect(api.joinGroup({ inviteCode: group.inviteCode })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("can rejoin a group after leaving with its existing invite code", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const { api } = await import("@/lib/client/api");
    const { MOCK_USER } = await import("@/lib/client/mock/data");
    const { groups } = await api.listGroups();
    const group = groups.find((entry) => entry.myRole === "member");
    if (!group) throw new Error("Expected a member mock group.");

    await expect(api.leaveGroup(group.id)).resolves.toEqual({ result: "left" });
    expect((await api.listGroups()).groups.some((entry) => entry.id === group.id)).toBe(false);

    const joined = await api.joinGroup({ inviteCode: group.inviteCode });
    expect(joined.group.id).toBe(group.id);
    expect(joined.group.myRole).toBe("member");
    expect((await api.listGroups()).groups.some((entry) => entry.id === group.id)).toBe(true);
    const detail = await api.getGroup(group.id);
    expect(detail.group.members.find((member) => member.id === MOCK_USER.id)?.role).toBe("member");
  });
});
