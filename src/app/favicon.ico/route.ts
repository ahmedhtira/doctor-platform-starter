import type { NextRequest } from "next/server";

// Browsers commonly request /favicon.ico directly. Reuse the current
// approved Dewini app icon so the browser tab stays in sync with branding.
export function GET(request: NextRequest) {
  return Response.redirect(new URL("/icon.png", request.url), 308);
}
