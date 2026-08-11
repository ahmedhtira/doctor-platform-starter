import type { MetadataRoute } from "next";

// The public patient-facing site (doctor search/profiles) should stay
// discoverable — it's a marketplace, being findable is the point. Only
// the staff-only and privacy-sensitive routes are excluded here.
// /manage already carries its own X-Robots-Tag/noindex header
// (next.config.ts) for defense in depth; disallowing it here too stops
// well-behaved crawlers before they even fetch it. No sitemap entry:
// none exists in this repo, out of M9 scope. M10 adds /admin (the
// platform-admin console) and /auth (invite/reset link redemption).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/*/login", "/*/dashboard", "/*/manage", "/*/admin", "/*/auth"],
    },
  };
}
