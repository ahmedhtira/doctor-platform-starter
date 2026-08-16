import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

const BASE_URL = "https://dewini.net";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const { data: doctors, error } = await supabase
    .from("doctors")
    .select("slug")
    .eq("is_published", true)
    .is("suspended_at", null);

  if (error) {
    throw new Error(`Failed to generate sitemap: ${error.message}`);
  }

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/fr`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE_URL}/ar`,
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  const doctorPages: MetadataRoute.Sitemap = (doctors ?? []).flatMap(
    ({ slug }) => [
      {
        url: `${BASE_URL}/fr/doctors/${slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      },
      {
        url: `${BASE_URL}/ar/doctors/${slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      },
    ],
  );

  return [...staticPages, ...doctorPages];
}
