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

  const safeLocale = locale === "ar" ? "ar" : "fr";

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    return NextResponse.redirect(
      new URL(
        `/${safeLocale}/login?authError=invalid_link`,
        request.url,
      ),
      303,
    );
  }

  const destination = `/${safeLocale}/auth/set-password`;

  /*
   * We intentionally do NOT immediately HTTP-redirect after verifyOtp().
   *
   * The recovery response first reaches the browser as a normal 200
   * document carrying Supabase's Set-Cookie headers. Once those cookies
   * are committed, the browser performs a fresh navigation to the
   * set-password page.
   *
   * This avoids the failing first-load handoff observed in production,
   * while keeping the token hash out of the destination URL.
   */
  const response = new NextResponse(
    `<!doctype html>
<html lang="${safeLocale}">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="refresh" content="0;url=${destination}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dewini</title>
  </head>
  <body>
    <p>
      ${
        safeLocale === "ar"
          ? `جارٍ المتابعة… <a href="${destination}">متابعة</a>`
          : `Redirection en cours… <a href="${destination}">Continuer</a>`
      }
    </p>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
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

    return NextResponse.redirect(
      new URL(
        `/${safeLocale}/login?authError=invalid_or_expired`,
        request.url,
      ),
      303,
    );
  }

  return response;
}
