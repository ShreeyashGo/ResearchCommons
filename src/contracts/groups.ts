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

export const UpdateGroupRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
}).refine((v) => v.name !== undefined || v.description !== undefined, "Nothing to update.");
export type UpdateGroupRequest = z.input<typeof UpdateGroupRequest>;
export const UpdateGroupResponse = z.object({ group: Group });
export const RotateInviteResponse = z.object({ inviteCode: z.string() });
export const UpdateMemberRoleRequest = z.object({ role: GroupRole });
export const LeaveGroupResponse = z.object({ result: z.enum(["left", "deleted"]) });

// GET /api/me
export const MeResponse = z.object({
  profile: ProfileSummary.extend({ email: z.string() }),
  groups: z.array(Group),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const UpdateProfileRequest = z.object({
  displayName: z.string().trim().min(1).max(80),
});
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequest>;
export const UpdateProfileResponse = z.object({
  profile: MeResponse.shape.profile,
});
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponse>;

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
