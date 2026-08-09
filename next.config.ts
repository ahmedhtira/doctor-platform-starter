import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  async headers() {
    return [
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
    ];
  },
};

export default withNextIntl(nextConfig);
