import type { Metadata } from "next";
import type { ReactNode } from "react";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Cairo, Fraunces } from "next/font/google";
import { routing, directionForLocale } from "@/i18n/routing";
import "../globals.css";

// Cairo carries the whole app's body/UI text in both fr and ar — one
// typeface across locales instead of a Latin font silently swapping out
// for Arabic. Fraunces adds an editorial, distinctive voice to headings;
// it has no Arabic glyphs, so per-glyph font fallback quietly hands
// Arabic headings back to Cairo (see globals.css --font-heading).
const bodyFont = Cairo({
  variable: "--font-cairo",
  subsets: ["latin", "arabic"],
});

const headingFont = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isArabic = locale === "ar";

  return {
    applicationName: "Dewini",
    manifest: `/${locale}/manifest.webmanifest`,
    title: {
      default: isArabic
        ? "دويني — احجز موعدك الطبي بسهولة"
        : "Dewini — Votre médecin, votre rendez-vous",
      template: "%s | Dewini",
    },
    description: isArabic
      ? "ابحث عن طبيب حسب الاختصاص أو المدينة واحجز موعدك عبر الإنترنت بسهولة."
      : "Trouvez un médecin par spécialité ou par ville et réservez votre rendez-vous en ligne simplement.",
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={directionForLocale(locale)}
      className={`${bodyFont.variable} ${headingFont.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
