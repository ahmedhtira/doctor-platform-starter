import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";
import type { Database } from "./database.types";

/**
 * Privileged Supabase client using the service role key. Bypasses Row Level
 * Security entirely — never import this outside trusted server-only code
 * paths (booking/cancel/reschedule RPCs, the seed script, secretary invites).
 * The `server-only` import above makes accidentally bundling this into
 * client code a build-time error, not a runtime leak.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
