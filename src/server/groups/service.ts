import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Group, GroupDetail, GroupRole } from "@/contracts/groups";
import { CreateGroupRequest } from "@/contracts/groups";
import { internal, notFound } from "@/server/http/errors";
import {
  toGroup,
  toGroupMember,
  type GroupRow,
  type MembershipRow,
  type ProfileRow,
} from "@/server/supabase/rows";

/** Membership + role for the current user; 404 for non-members and bad ids. */
export async function requireGroupMember(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<{ role: GroupRole }> {
  const { data, error } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw internal(`Membership lookup failed: ${error.message}`);
  }
  if (!data) {
    throw notFound("Group not found.");
  }
  return { role: data.role as GroupRole };
}

export async function fetchProfiles(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, ProfileRow>> {
  const ids = [...new Set(userIds)];
  const map = new Map<string, ProfileRow>();
  if (ids.length === 0) {
    return map;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids);
  if (error) {
    throw internal(`Profile lookup failed: ${error.message}`);
  }
  for (const row of (data ?? []) as ProfileRow[]) {
    map.set(row.id, row);
  }
  return map;
}

async function paperCounts(
  supabase: SupabaseClient,
  groupIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (groupIds.length === 0) {
    return counts;
  }
  const { data, error } = await supabase
    .from("group_papers")
    .select("group_id")
    .in("group_id", groupIds);
  if (error) {
    throw internal(`Paper count lookup failed: ${error.message}`);
  }
  for (const row of (data ?? []) as { group_id: string }[]) {
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }
  return counts;
}

async function toGroupWithCounts(
  supabase: SupabaseClient,
  row: GroupRow,
  userId: string,
): Promise<Group> {
  const [{ data: members, error: membersError }, papers] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("user_id, role")
      .eq("group_id", row.id),
    paperCounts(supabase, [row.id]),
  ]);
  if (membersError) {
    throw internal(`Membership lookup failed: ${membersError.message}`);
  }
  const list = (members ?? []) as Pick<MembershipRow, "user_id" | "role">[];
  const myRole = (list.find((m) => m.user_id === userId)?.role ??
    "member") as GroupRole;
  return toGroup(row, myRole, list.length, papers.get(row.id) ?? 0);
}

export async function listGroups(
  supabase: SupabaseClient,
  userId: string,
): Promise<Group[]> {
  const { data, error } = await supabase
    .from("research_groups")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    throw internal(`Group lookup failed: ${error.message}`);
  }
  const groups = (data ?? []) as GroupRow[];
  if (groups.length === 0) {
    return [];
  }
  const groupIds = groups.map((g) => g.id);
  const [{ data: memberships, error: membershipError }, counts] =
    await Promise.all([
      supabase
        .from("group_memberships")
        .select("group_id, user_id, role")
        .in("group_id", groupIds),
      paperCounts(supabase, groupIds),
    ]);
  if (membershipError) {
    throw internal(`Membership lookup failed: ${membershipError.message}`);
  }
  const byGroup = new Map<string, Pick<MembershipRow, "user_id" | "role">[]>();
  for (const m of (memberships ?? []) as Pick<
    MembershipRow,
    "group_id" | "user_id" | "role"
  >[]) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push(m);
    byGroup.set(m.group_id, list);
  }
  return groups.map((g) => {
    const members = byGroup.get(g.id) ?? [];
    const myRole = (members.find((m) => m.user_id === userId)?.role ??
      "member") as GroupRole;
    return toGroup(g, myRole, members.length, counts.get(g.id) ?? 0);
  });
}

export async function createGroup(
  supabase: SupabaseClient,
  userId: string,
  input: z.input<typeof CreateGroupRequest>,
): Promise<Group> {
  const body = CreateGroupRequest.parse(input);
  const { data, error } = await supabase.rpc("create_group", {
    p_name: body.name,
    p_description: body.description,
  });
  if (error || !data) {
    throw internal(`create_group failed: ${error?.message ?? "no group returned"}`);
  }
  return toGroupWithCounts(supabase, data as GroupRow, userId);
}

export async function joinGroup(
  supabase: SupabaseClient,
  userId: string,
  inviteCode: string,
): Promise<Group> {
  const { data, error } = await supabase.rpc("join_group", {
    p_invite_code: inviteCode,
  });
  if (error || !data) {
    if (error?.code === "P0002") {
      throw notFound("Invalid invite code.");
    }
    throw internal(`join_group failed: ${error?.message ?? "no group returned"}`);
  }
  return toGroupWithCounts(supabase, data as GroupRow, userId);
}

export async function getGroup(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
): Promise<GroupDetail> {
  await requireGroupMember(supabase, groupId, userId);
  const { data: groupRow, error: groupError } = await supabase
    .from("research_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError) {
    throw internal(`Group lookup failed: ${groupError.message}`);
  }
  if (!groupRow) {
    throw notFound("Group not found.");
  }
  const [{ data: members, error: membersError }, papers] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("group_id, user_id, role, joined_at")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true }),
    paperCounts(supabase, [groupId]),
  ]);
  if (membersError) {
    throw internal(`Membership lookup failed: ${membersError.message}`);
  }
  const rows = (members ?? []) as MembershipRow[];
  const profiles = await fetchProfiles(
    supabase,
    rows.map((m) => m.user_id),
  );
  const myRole = (rows.find((m) => m.user_id === userId)?.role ??
    "member") as GroupRole;
  const group = toGroup(
    groupRow as GroupRow,
    myRole,
    rows.length,
    papers.get(groupId) ?? 0,
  );
  return {
    ...group,
    members: rows.map((m) =>
      toGroupMember(m, profiles.get(m.user_id) ?? { id: m.user_id, display_name: "Unknown" }),
    ),
  };
}
