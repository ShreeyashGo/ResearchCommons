import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/public-env";
import { parseServerEnv } from "@/server/env";

// Server-side clients never subscribe to Realtime; provide a transport that
// fails only if something tries to open a socket (Node 20 has no WebSocket).
class NoServerRealtime {
  constructor() {
    throw new Error("Realtime is not available in server-side clients.");
  }
}

export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = parseServerEnv();

  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: NoServerRealtime as never,
    },
  });
}
