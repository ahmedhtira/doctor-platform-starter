import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { routing } from "./i18n/routing";
import type { Database } from "./lib/supabase/database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./lib/supabase/env";

const handleI18nRouting = createMiddleware(routing);
function isAuthSessionHandoff(pathname: string) {
  return (
    pathname.endsWith("/auth/confirm") ||
    pathname.endsWith("/auth/set-password")
  );
}

export default async function proxy(request: NextRequest) {
  // Supabase may refresh/replace auth cookies while validating the session.
  // We mutate the incoming request immediately so Server Components see
  // the refreshed session, then apply the same cookie/header changes to
  // next-intl's final response.
  if (isAuthSessionHandoff(request.nextUrl.pathname)) {
    return handleI18nRouting(request);
  }

  const authMutations: Array<(response: NextResponse) => void> = [];

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet, headers) {
          // Make refreshed cookies visible to downstream Server Components.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          // Keep the exact Supabase cookie options + anti-cache headers
          // for the final next-intl response.
          authMutations.push((response) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });

            for (const [name, value] of Object.entries(headers ?? {})) {
              response.headers.set(name, String(value));
            }
          });
        },
      },
    },
  );

  // Current Supabase SSR recommendation: this triggers lazy session
  // initialization/refresh before the application renders.
  await supabase.auth.getClaims();

  // Run Dewini's existing FR/AR routing AFTER request cookies have been
  // refreshed so we don't lose next-intl redirects/rewrites.
  const response = handleI18nRouting(request);

  for (const applyMutation of authMutations) {
    applyMutation(response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
