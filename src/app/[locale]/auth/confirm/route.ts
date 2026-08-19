import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Redemption endpoint for both the doctor-invite and password-reset
// links (M10) — Supabase's link flow is PKCE-based: visiting the link
// lands here with token_hash+type query params, no session yet.
// verifyOtp() exchanges it for a real session (cookie-bound client, so
// this must be a Route Handler with a mutable response — server.ts's own
// comment already notes cookie writes are unreliable from a plain Server
// Component render). Only after that does /auth/set-password's
// client-side updateUser({password}) call actually set the password.
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    return NextResponse.redirect(new URL(`/${locale}/login?authError=invalid_link`, request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
  console.warn("auth/confirm: OTP verification failed", {
    type,
    code: error.code,
    status: error.status,
  });

  return NextResponse.redirect(
    new URL(`/${locale}/login?authError=invalid_or_expired`, request.url),
  );
}

  return NextResponse.redirect(new URL(`/${locale}/auth/set-password`, request.url));
}
