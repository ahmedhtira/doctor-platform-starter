import type { NextRequest } from "next/server";

// Browsers request /favicon.png directly. Keep that static path from falling
// through to the dynamic [locale] route, where "favicon.png" would otherwise
// be treated as a locale segment. Reuse Dewini's existing square app icon.
export function GET(request: NextRequest) {
  return Response.redirect(new URL("/dewini-pro-icon-192.png", request.url), 308);
}
