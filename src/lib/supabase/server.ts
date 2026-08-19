import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

const JWT_CLOCK_SKEW_RETRY_DELAY_MS = 1000;

async function fetchWithJwtClockSkewRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const response = await fetch(request.clone());

  // Never retry mutations or unrelated Supabase requests.
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    response.status !== 401 ||
    !new URL(request.url).pathname.startsWith("/rest/v1/")
  ) {
    return response;
  }

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as
    | {
        code?: unknown;
        message?: unknown;
      }
    | null;

  // A freshly issued Supabase JWT can very briefly be considered
  // "from the future" by PostgREST if clocks differ slightly.
  // Retry this one known transient failure exactly once.
  if (
    payload?.code !== "PGRST303" ||
    payload?.message !== "JWT issued at future"
  ) {
    return response;
  }

  await new Promise((resolve) =>
    setTimeout(resolve, JWT_CLOCK_SKEW_RETRY_DELAY_MS),
  );

  return fetch(request.clone());
}

/**
 * Server-side Supabase client for Server Components/Actions, scoped to the
 * current user's session via cookies. Still bound by Row Level Security —
 * this is not the privileged client. See service-role.ts for that.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      global: {
        fetch: fetchWithJwtClockSkewRetry,
      },
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
    },
  );
}
