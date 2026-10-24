import { z } from "zod";
import { IsoDate, ProfileSummary, Uuid } from "./common";

export const GroupRole = z.enum(["owner", "member"]);
export type GroupRole = z.infer<typeof GroupRole>;

export const Group = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string(),
  /** Only returned to members. */
  inviteCode: z.string(),
  myRole: GroupRole,
  memberCount: z.number().int(),
  paperCount: z.number().int(),
  createdAt: IsoDate,
});
export type Group = z.infer<typeof Group>;

export const GroupMember = ProfileSummary.extend({ role: GroupRole, joinedAt: IsoDate });
export type GroupMember = z.infer<typeof GroupMember>;

export const GroupDetail = Group.extend({ members: z.array(GroupMember) });
export type GroupDetail = z.infer<typeof GroupDetail>;

// GET /api/me
export const MeResponse = z.object({
  profile: ProfileSummary.extend({ email: z.string() }),
  groups: z.array(Group),
});
export type MeResponse = z.infer<typeof MeResponse>;

// POST /api/groups
export const CreateGroupRequest = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>;
export const CreateGroupResponse = z.object({ group: Group });

// GET /api/groups
export const ListGroupsResponse = z.object({ groups: z.array(Group) });

// POST /api/groups/join
export const JoinGroupRequest = z.object({ inviteCode: z.string().trim().min(4).max(64) });
export const JoinGroupResponse = z.object({ group: Group });

// GET /api/groups/:gid
export const GetGroupResponse = z.object({ group: GroupDetail });
