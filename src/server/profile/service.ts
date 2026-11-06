import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  UpdateProfileRequest,
  type UpdateProfileResponse,
} from "@/contracts/groups";
import { internal } from "@/server/http/errors";

export async function updateProfile(
  supabase: SupabaseClient,
  user: User,
  input: unknown,
): Promise<UpdateProfileResponse> {
  const { displayName } = UpdateProfileRequest.parse(input);
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id, display_name")
    .single();

  if (error || !data) {
    throw internal("Profile update failed.");
  }

  return {
    profile: {
      id: data.id,
      displayName: data.display_name,
      email: user.email ?? "",
    },
  };
}
