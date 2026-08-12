import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    return new Response(null, { status: 404 });
  }

  const isArabic = locale === "ar";
  const manifest = {
    id: "/dewini-pro",
    lang: locale,
    dir: isArabic ? "rtl" : "ltr",
    name: isArabic ? "دويني برو — مساحة الطبيب" : "Dewini Pro — Espace médecin",
    short_name: "Dewini Pro",
    description: isArabic
      ? "إدارة المواعيد والتقويم وأوقات التوفر من مساحة الطبيب."
      : "Gérez les rendez-vous, le calendrier et les disponibilités depuis l’espace médecin.",
    start_url: `/${locale}/dashboard?source=pwa`,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fbf8f2",
    theme_color: "#124f40",
    prefer_related_applications: false,
    categories: ["medical", "productivity"],
    icons: [
      {
        src: "/dewini-pro-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: isArabic ? "مواعيد اليوم" : "Aujourd’hui",
        short_name: isArabic ? "اليوم" : "Aujourd’hui",
        url: `/${locale}/dashboard`,
      },
      {
        name: isArabic ? "التقويم" : "Calendrier",
        short_name: isArabic ? "التقويم" : "Calendrier",
        url: `/${locale}/dashboard/calendar`,
      },
      {
        name: isArabic ? "أوقات التوفر" : "Disponibilités",
        short_name: isArabic ? "التوفر" : "Disponibilités",
        url: `/${locale}/dashboard/availability`,
      },
    ],
  };

  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
