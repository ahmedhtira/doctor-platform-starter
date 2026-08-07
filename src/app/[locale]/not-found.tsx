import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Root src/app/not-found.tsx has no locale/dir awareness (hardcoded
// lang="fr", no NextIntlClientProvider). This one sits inside
// [locale]/layout.tsx, so a notFound() call from any page under [locale]
// (e.g. an unknown doctor slug) renders with the correct lang/dir/messages
// instead of falling through to that hardcoded fallback.
export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground mt-2">{t("description")}</p>
      <Link href="/" className="mt-6 inline-block underline">
        {t("backHome")}
      </Link>
    </div>
  );
}
