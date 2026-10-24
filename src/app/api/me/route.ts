import { MeResponse } from "@/contracts/groups";
import { json, requireUser, routeHandler } from "@/server/http/handler";
import { internal } from "@/server/http/errors";
import { listGroups } from "@/server/groups/service";
import type { ProfileRow } from "@/server/supabase/rows";

export const GET = routeHandler(async () => {
  const { supabase, user } = await requireUser();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    throw internal(`Profile lookup failed: ${error.message}`);
  }
  const row = profile as ProfileRow | null;
  const groups = await listGroups(supabase, user.id);
  return json(
    MeResponse.parse({
      profile: {
        id: user.id,
        displayName:
          row?.display_name ??
          user.email?.split("@")[0] ??
          "Researcher",
        email: user.email ?? "",
      },
      groups,
    }),
  );
});
