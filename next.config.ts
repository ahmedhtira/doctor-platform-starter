import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Baseline, platform-wide (M9 launch readiness) — additive
        // alongside the /manage-specific block below, not a replacement.
        // Deliberately just these two, not a full Content-Security-Policy:
        // a CSP for this app's inline-script/style needs is a meaningfully
        // riskier change to get right without breaking something, and
        // isn't what's blocking a small pilot — see DEPLOYMENT.md.
        // Strict-Transport-Security is intentionally not set here either;
        // Vercel applies it automatically for custom domains on its
        // platform, verified by the smoke-test checklist rather than
        // asserted redundantly here.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // /manage carries privacy-sensitive appointment data reachable by
        // anyone holding the link — never cache it, never leak the URL
        // (and its token fragment's origin page) via Referer, never let it
        // get indexed. See PROJECT_SPEC.md "Patient self-service (M5)".
        source: "/:locale/manage/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Always let browsers check for a newer install helper. It is a
        // network-only service worker and never caches patient/staff data.
        source: "/dewini-pro-sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
