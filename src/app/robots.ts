import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/*/login",
        "/*/dashboard",
        "/*/manage",
        "/*/admin",
        "/*/auth",
      ],
    },
    sitemap: "https://dewini.net/sitemap.xml",
  };
}
