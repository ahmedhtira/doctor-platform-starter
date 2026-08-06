import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Server-side Supabase client for Server Components/Actions, scoped to the
 * current user's session via cookies. Still bound by Row Level Security —
 * this is not the privileged client. See service-role.ts for that.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component without a mutable response —
          // safe to ignore as long as middleware also refreshes the session.
        }
      },
    },
  });
}
