import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    return NextResponse.redirect(
      new URL(
        `/${locale}/login?authError=invalid_link`,
        request.url,
      ),
      303,
    );
  }

  /*
   * Important:
   * The response that receives Supabase's auth cookies must be the SAME
   * response returned to the browser.
   *
   * Previously we used the shared server client and then created a separate
   * redirect response. That can make the browser/server auth state briefly
   * disagree during the first redirect after verifyOtp().
   */
  const response = NextResponse.redirect(
    new URL(`/${locale}/auth/set-password`, request.url),
    303,
  );

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          for (const [name, value] of Object.entries(headers ?? {})) {
            response.headers.set(name, String(value));
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    console.warn("auth/confirm: OTP verification failed", {
      type,
      code: error.code,
      status: error.status,
    });

    response.headers.set(
      "location",
      new URL(
        `/${locale}/login?authError=invalid_or_expired`,
        request.url,
      ).toString(),
    );
  }

  return response;
}
