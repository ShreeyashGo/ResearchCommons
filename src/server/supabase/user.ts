import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/public-env";

// Server-side clients never subscribe to Realtime; provide a transport that
// fails only if something tries to open a socket (Node 20 has no WebSocket).
class NoServerRealtime {
  constructor() {
    throw new Error("Realtime is not available in server-side clients.");
  }
}

export async function createUserClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();

  return createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            return;
          }
        },
      },
      realtime: {
        transport: NoServerRealtime as never,
      },
    },
  );
}
