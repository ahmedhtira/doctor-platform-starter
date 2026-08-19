import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

const SUPABASE_ORIGIN = new URL(getSupabaseUrl()).origin;

// Total maximum wait: 5 seconds.
// Only used for the exact transient "JWT issued at future" failure.
const JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [250, 750, 1500, 2500] as const;

function isSafeRetryableDataRequest(request: Request) {
  const url = new URL(request.url);

  return (
    (request.method === "GET" || request.method === "HEAD") &&
    url.origin === SUPABASE_ORIGIN &&
    url.pathname.startsWith("/rest/v1/")
  );
}

async function isJwtIssuedAtFutureResponse(
  response: Response,
): Promise<boolean> {
  if (response.status !== 401) {
    return false;
  }

  const body = await response
    .clone()
    .text()
    .catch(() => "");

  return body.includes("JWT issued at future");
}

async function fetchWithJwtClockSkewRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);

  let response = await fetch(request.clone());

  // Never retry mutations, Auth requests, Storage requests,
  // unrelated hosts, or ordinary permission/session failures.
  if (!isSafeRetryableDataRequest(request)) {
    return response;
  }

  for (
    let attempt = 0;
    attempt < JWT_CLOCK_SKEW_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    if (!(await isJwtIssuedAtFutureResponse(response))) {
      return response;
    }

    const delayMs = JWT_CLOCK_SKEW_RETRY_DELAYS_MS[attempt];

    console.warn("supabase: retrying transient JWT clock-skew failure", {
      attempt: attempt + 1,
      delayMs,
      path: new URL(request.url).pathname,
    });

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    response = await fetch(request.clone());
  }

  // If Supabase is still rejecting the token after the bounded retries,
  // return the genuine final response instead of masking a persistent issue.
  if (await isJwtIssuedAtFutureResponse(response)) {
    console.error("supabase: JWT clock-skew retries exhausted", {
      retries: JWT_CLOCK_SKEW_RETRY_DELAYS_MS.length,
      path: new URL(request.url).pathname,
    });
  }

  return response;
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
            // safe to ignore as long as Proxy also refreshes the session.
          }
        },
      },
    },
  );
}
